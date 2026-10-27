import { BadRequestError, ConflictError, NotFoundError } from '../../utils/errors';
import { slugify } from '../../utils/slug';
import { productsService } from '../products/products.service';
import { categoriesRepository } from './categories.repository';

interface CategoryRow {
  id: string;
  parent_id: string | null;
  name: string;
  slug: string;
  image_url: string | null;
  [key: string]: unknown;
}

interface CategoryTreeNode {
  id: string;
  name: string;
  slug: string;
  imageUrl: string | null;
  children: CategoryTreeNode[];
}

/**
 * Builds the storefront tree from ACTIVE categories only. A node whose parent is inactive
 * (or missing) is hidden together with its parent instead of leaking out as a fake root.
 */
function buildTree(rows: CategoryRow[]): CategoryTreeNode[] {
  const byId = new Map<string, CategoryTreeNode>();
  const roots: CategoryTreeNode[] = [];

  for (const row of rows) {
    byId.set(row.id, { id: row.id, name: row.name, slug: row.slug, imageUrl: row.image_url, children: [] });
  }
  for (const row of rows) {
    const node = byId.get(row.id)!;
    if (!row.parent_id) {
      roots.push(node);
    } else if (byId.has(row.parent_id) && row.parent_id !== row.id) {
      byId.get(row.parent_id)!.children.push(node);
    }
  }
  return roots;
}

async function assertValidParent(id: string | null, parentId: string | null | undefined) {
  if (!parentId) return;
  if (id && parentId === id) throw new BadRequestError('A category cannot be its own parent');
  const parent = await categoriesRepository.findById(parentId);
  if (!parent) throw new BadRequestError('Parent category does not exist');
  if (id) {
    const ancestors = await categoriesRepository.ancestorIds(parentId);
    if (ancestors.includes(id)) {
      throw new BadRequestError('Invalid parent: it would create a circular category hierarchy');
    }
  }
}

export const categoriesService = {
  async listPublic() {
    return categoriesRepository.listActive();
  },

  async tree() {
    return buildTree((await categoriesRepository.listActive()) as CategoryRow[]);
  },

  /** Same filters, sorting and DTO as /products, scoped to the category (and its sub-categories). */
  async productsInCategory(slug: string, query: Record<string, unknown>) {
    const category = await categoriesRepository.findBySlug(slug);
    if (!category || !category.is_active) throw new NotFoundError('Category not found');
    const { products, meta } = await productsService.listPublic({ ...(query as object), category: slug });
    return { category, products, meta };
  },

  // ---- Admin ----
  async adminList() {
    return categoriesRepository.listAll();
  },

  async adminCreate(input: {
    name: string;
    slug?: string;
    parentId?: string | null;
    description?: string | null;
    imageUrl?: string | null;
    sortOrder: number;
    isActive: boolean;
  }) {
    const slug = input.slug || slugify(input.name);
    if (slug.length < 2) throw new BadRequestError('Could not derive a valid slug from the name');
    if (await categoriesRepository.findBySlugAny(slug)) throw new ConflictError('A category with this slug already exists');
    await assertValidParent(null, input.parentId);
    return categoriesRepository.create({ ...input, slug });
  },

  async adminUpdate(id: string, input: Record<string, unknown>) {
    const existing = await categoriesRepository.findById(id);
    if (!existing) throw new NotFoundError('Category not found');
    if (typeof input.slug === 'string' && input.slug !== existing.slug) {
      const owner = await categoriesRepository.findBySlugAny(input.slug);
      if (owner && owner.id !== id) throw new ConflictError('A category with this slug already exists');
    }
    if ('parentId' in input) await assertValidParent(id, input.parentId as string | null);
    const after = await categoriesRepository.update(id, input);
    return { before: existing, after };
  },

  async adminDelete(id: string) {
    const existing = await categoriesRepository.findById(id);
    if (!existing) throw new NotFoundError('Category not found');
    const count = await categoriesRepository.productCount(id);
    if (count > 0) {
      throw new ConflictError(
        `This category still contains ${count} product(s). Move them to another category first (or deactivate the category to hide it).`
      );
    }
    await categoriesRepository.delete(id);
    return existing;
  },
};
