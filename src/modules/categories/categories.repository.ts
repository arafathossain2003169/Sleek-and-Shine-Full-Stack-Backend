import { query } from '../../config/db';
import { updateRow } from '../../utils/sql';

export const categoriesRepository = {
  async listActive() {
    const result = await query(
      'SELECT * FROM categories WHERE is_active = TRUE ORDER BY sort_order ASC, name ASC, id ASC'
    );
    return result.rows;
  },

  async listAll() {
    const result = await query('SELECT * FROM categories ORDER BY sort_order ASC, name ASC, id ASC');
    return result.rows;
  },

  async findBySlug(slug: string) {
    const result = await query('SELECT * FROM categories WHERE slug = $1', [slug]);
    return result.rows[0] ?? null;
  },

  async findById(id: string) {
    const result = await query('SELECT * FROM categories WHERE id = $1', [id]);
    return result.rows[0] ?? null;
  },

  async findBySlugAny(slug: string) {
    const result = await query('SELECT id FROM categories WHERE slug = $1', [slug]);
    return result.rows[0] ?? null;
  },

  /** Ids of the category's ancestors, nearest first (cycle-safe). */
  async ancestorIds(id: string): Promise<string[]> {
    const result = await query<{ id: string }>(
      `WITH RECURSIVE up AS (
         SELECT parent_id AS id FROM categories WHERE id = $1
         UNION
         SELECT c.parent_id FROM categories c JOIN up ON c.id = up.id
       ) SELECT id FROM up WHERE id IS NOT NULL`,
      [id]
    );
    return result.rows.map((r) => r.id);
  },

  async productCount(id: string): Promise<number> {
    const r = await query<{ c: string }>('SELECT COUNT(*)::text AS c FROM products WHERE category_id = $1', [id]);
    return parseInt(r.rows[0].c, 10);
  },

  async create(input: {
    name: string;
    slug: string;
    parentId?: string | null;
    description?: string | null;
    imageUrl?: string | null;
    sortOrder: number;
    isActive: boolean;
  }) {
    const result = await query(
      `INSERT INTO categories (name, slug, parent_id, description, image_url, sort_order, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING *`,
      [
        input.name, input.slug, input.parentId ?? null, input.description ?? null,
        input.imageUrl ?? null, input.sortOrder, input.isActive,
      ]
    );
    return result.rows[0];
  },

  async update(id: string, input: Record<string, unknown>) {
    return updateRow(
      'categories',
      id,
      {
        name: 'name',
        slug: 'slug',
        parentId: 'parent_id',
        description: 'description',
        imageUrl: 'image_url',
        sortOrder: 'sort_order',
        isActive: 'is_active',
      },
      input
    );
  },

  async delete(id: string) {
    const result = await query('DELETE FROM categories WHERE id = $1 RETURNING id', [id]);
    return result.rows[0] ?? null;
  },
};
