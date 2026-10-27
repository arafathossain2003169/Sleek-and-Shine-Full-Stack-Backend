import { query } from '../../../config/db';
import { escapeLike } from '../../../utils/sql';

export const customersRepository = {
  async list(limit: number, offset: number, search?: string) {
    const clauses: string[] = [`role = 'customer'`];
    const values: unknown[] = [];
    if (search) {
      values.push(`%${escapeLike(search)}%`);
      clauses.push(`(name ILIKE $${values.length} OR email ILIKE $${values.length})`);
    }
    const where = `WHERE ${clauses.join(' AND ')}`;

    const countResult = await query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM users ${where}`,
      values
    );

    values.push(limit, offset);
    const dataResult = await query(
      `SELECT id, name, email, phone, status, email_verified, created_at
       FROM users ${where}
       ORDER BY created_at DESC, id ASC
       LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values
    );
    return { rows: dataResult.rows, total: parseInt(countResult.rows[0].count, 10) };
  },

  async findById(id: string) {
    const result = await query(
      `SELECT id, name, email, phone, status, email_verified, role, created_at
       FROM users WHERE id = $1 AND role = 'customer'`,
      [id]
    );
    if (!result.rows[0]) return null;

    const ordersResult = await query(
      `SELECT id, order_number, status, payment_status, total, created_at
       FROM orders WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20`,
      [id]
    );
    const addressesResult = await query('SELECT * FROM addresses WHERE user_id = $1 ORDER BY is_default DESC, created_at DESC', [id]);

    return { ...result.rows[0], recentOrders: ordersResult.rows, addresses: addressesResult.rows };
  },

  async updateStatus(id: string, status: string) {
    const result = await query(
      `UPDATE users SET status = $2, updated_at = now()
       WHERE id = $1 AND role = 'customer'
       RETURNING id, name, email, status`,
      [id, status]
    );
    return result.rows[0] ?? null;
  },
};
