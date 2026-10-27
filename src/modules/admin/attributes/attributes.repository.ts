import { query } from '../../../config/db';
import { updateRow } from '../../../utils/sql';

export interface AttributeDefinitionRow {
  id: string;
  name: string;
  slug: string;
  type: string;
  predefined_values: unknown[];
  is_required: boolean;
  is_filterable: boolean;
  is_visible: boolean;
  applies_to: 'product' | 'variant' | 'both';
  sort_order: number;
  created_at: Date;
  updated_at: Date;
}

export const attributeDefinitionsRepository = {
  async list(): Promise<AttributeDefinitionRow[]> {
    const result = await query<AttributeDefinitionRow>(
      'SELECT * FROM attribute_definitions ORDER BY sort_order ASC, created_at ASC'
    );
    return result.rows;
  },

  async findById(id: string): Promise<AttributeDefinitionRow | null> {
    const result = await query<AttributeDefinitionRow>(
      'SELECT * FROM attribute_definitions WHERE id = $1',
      [id]
    );
    return result.rows[0] ?? null;
  },

  async findBySlug(slug: string): Promise<AttributeDefinitionRow | null> {
    const result = await query<AttributeDefinitionRow>(
      'SELECT * FROM attribute_definitions WHERE slug = $1',
      [slug]
    );
    return result.rows[0] ?? null;
  },

  async create(input: {
    name: string;
    slug: string;
    type: string;
    predefinedValues: unknown[];
    isRequired: boolean;
    isFilterable: boolean;
    isVisible: boolean;
    appliesTo: string;
    sortOrder: number;
  }): Promise<AttributeDefinitionRow> {
    const result = await query<AttributeDefinitionRow>(
      `INSERT INTO attribute_definitions
        (name, slug, type, predefined_values, is_required, is_filterable, is_visible, applies_to, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING *`,
      [
        input.name, input.slug, input.type, JSON.stringify(input.predefinedValues),
        input.isRequired, input.isFilterable, input.isVisible, input.appliesTo, input.sortOrder,
      ]
    );
    return result.rows[0];
  },

  async update(id: string, input: Record<string, unknown>): Promise<AttributeDefinitionRow | null> {
    const row = await updateRow(
      'attribute_definitions',
      id,
      {
        name: 'name',
        type: 'type',
        predefinedValues: { column: 'predefined_values', json: true },
        isRequired: 'is_required',
        isFilterable: 'is_filterable',
        isVisible: 'is_visible',
        appliesTo: 'applies_to',
        sortOrder: 'sort_order',
      },
      input
    );
    return (row as unknown as AttributeDefinitionRow) ?? null;
  },

  /** Does any product/variant currently store a value under this attribute key? */
  async isInUse(slug: string): Promise<boolean> {
    const result = await query(
      `SELECT 1 FROM products WHERE attributes ? $1
       UNION ALL SELECT 1 FROM product_variants WHERE attributes ? $1 LIMIT 1`,
      [slug]
    );
    return (result.rowCount ?? 0) > 0;
  },

  /** Removes the key from every product/variant so no orphan values stay behind. */
  async stripFromProducts(slug: string): Promise<void> {
    await query('UPDATE products SET attributes = attributes - $1 WHERE attributes ? $1', [slug]);
    await query('UPDATE product_variants SET attributes = attributes - $1 WHERE attributes ? $1', [slug]);
  },

  async delete(id: string): Promise<{ id: string } | null> {
    const result = await query<{ id: string }>(
      'DELETE FROM attribute_definitions WHERE id = $1 RETURNING id',
      [id]
    );
    return result.rows[0] ?? null;
  },
};
