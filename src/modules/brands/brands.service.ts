import { BadRequestError, ConflictError, NotFoundError } from '../../utils/errors';
import { slugify } from '../../utils/slug';
import { productsService } from '../products/products.service';
import { brandsRepository } from './brands.repository';

export const brandsService = {
  async listPublic() {
    return brandsRepository.listActive();
  },

  async productsForBrand(slug: string, query: Record<string, unknown>) {
    const brand = await brandsRepository.findBySlug(slug);
    if (!brand || !brand.is_active) throw new NotFoundError('Brand not found');
    const { products, meta } = await productsService.listPublic({ ...(query as object), brand: slug });
    return { brand, products, meta };
  },

  async adminList() {
    return brandsRepository.listAll();
  },

  async adminCreate(input: { name: string; slug?: string; description?: string | null; logoUrl?: string | null; isActive: boolean }) {
    const slug = input.slug || slugify(input.name);
    if (slug.length < 2) throw new BadRequestError('Could not derive a valid slug from the name');
    if (await brandsRepository.findBySlug(slug)) throw new ConflictError('A brand with this slug already exists');
    return brandsRepository.create({ ...input, slug });
  },

  async adminUpdate(id: string, input: Record<string, unknown>) {
    const existing = await brandsRepository.findById(id);
    if (!existing) throw new NotFoundError('Brand not found');
    if (typeof input.slug === 'string' && input.slug !== existing.slug) {
      const owner = await brandsRepository.findBySlug(input.slug);
      if (owner && owner.id !== id) throw new ConflictError('A brand with this slug already exists');
    }
    const after = await brandsRepository.update(id, input);
    return { before: existing, after };
  },

  async adminDelete(id: string) {
    const existing = await brandsRepository.findById(id);
    if (!existing) throw new NotFoundError('Brand not found');
    await brandsRepository.delete(id); // products keep existing (brand_id -> NULL)
    return existing;
  },
};
