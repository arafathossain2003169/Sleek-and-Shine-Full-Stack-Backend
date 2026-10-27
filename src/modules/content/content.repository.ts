import { query } from '../../config/db';
import { updateRow } from '../../utils/sql';

export const contentRepository = {
  async listActiveSections() {
    const result = await query(
      `SELECT * FROM homepage_sections
       WHERE is_active = TRUE
         AND (starts_at IS NULL OR starts_at <= now())
         AND (ends_at IS NULL OR ends_at >= now())
       ORDER BY sort_order ASC, created_at ASC`
    );
    return result.rows;
  },

  async listAllSections() {
    const result = await query(
      'SELECT * FROM homepage_sections ORDER BY sort_order ASC, created_at ASC'
    );
    return result.rows;
  },

  async findById(id: string) {
    const result = await query('SELECT * FROM homepage_sections WHERE id = $1', [id]);
    return result.rows[0] ?? null;
  },

  async create(input: Record<string, unknown>) {
    const result = await query(
      `INSERT INTO homepage_sections
        (type, title, subtitle, image_url, button_text, button_link, data, sort_order, is_active, starts_at, ends_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING *`,
      [
        input.type, input.title, input.subtitle ?? null, input.imageUrl ?? null,
        input.buttonText ?? null, input.buttonLink ?? null,
        input.data ? JSON.stringify(input.data) : '{}',
        input.sortOrder ?? 0, input.isActive ?? true,
        input.startsAt ?? null, input.endsAt ?? null,
      ]
    );
    return result.rows[0];
  },

  async update(id: string, input: Record<string, unknown>) {
    return updateRow(
      'homepage_sections',
      id,
      {
        type: 'type',
        title: 'title',
        subtitle: 'subtitle',
        imageUrl: 'image_url',
        buttonText: 'button_text',
        buttonLink: 'button_link',
        data: { column: 'data', json: true },
        sortOrder: 'sort_order',
        isActive: 'is_active',
        startsAt: 'starts_at',
        endsAt: 'ends_at',
      },
      input
    );
  },

  async delete(id: string) {
    const result = await query('DELETE FROM homepage_sections WHERE id = $1 RETURNING id', [id]);
    return result.rows[0] ?? null;
  },
};
