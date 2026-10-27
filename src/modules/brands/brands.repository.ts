import { query } from '../../config/db';
import { updateRow } from '../../utils/sql';

export const brandsRepository = {
  async listActive() {
    const result = await query('SELECT * FROM brands WHERE is_active = TRUE ORDER BY name ASC, id ASC');
    return result.rows;
  },
  async listAll() {
    const result = await query('SELECT * FROM brands ORDER BY name ASC, id ASC');
    return result.rows;
  },
  async findBySlug(slug: string) {
    const result = await query('SELECT * FROM brands WHERE slug = $1', [slug]);
    return result.rows[0] ?? null;
  },
  async findById(id: string) {
    const result = await query('SELECT * FROM brands WHERE id = $1', [id]);
    return result.rows[0] ?? null;
  },
  async create(input: {
    name: string;
    slug: string;
    description?: string | null;
    logoUrl?: string | null;
    isActive: boolean;
  }) {
    const result = await query(
      `INSERT INTO brands (name, slug, description, logo_url, is_active)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [input.name, input.slug, input.description ?? null, input.logoUrl ?? null, input.isActive]
    );
    return result.rows[0];
  },
  async update(id: string, input: Record<string, unknown>) {
    return updateRow(
      'brands',
      id,
      { name: 'name', slug: 'slug', description: 'description', logoUrl: 'logo_url', isActive: 'is_active' },
      input
    );
  },
  async delete(id: string) {
    const result = await query('DELETE FROM brands WHERE id = $1 RETURNING id', [id]);
    return result.rows[0] ?? null;
  },
};
