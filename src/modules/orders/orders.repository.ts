import { PoolClient } from 'pg';
import { query } from '../../config/db';
import { escapeLike } from '../../utils/sql';

const ORDER_ITEMS_SUBQUERY = `
  COALESCE(
    (SELECT json_agg(json_build_object(
      'id', oi.id, 'productId', oi.product_id, 'variantId', oi.variant_id,
      'productName', oi.product_name, 'variantName', oi.variant_name, 'sku', oi.sku,
      'unitPrice', oi.unit_price, 'quantity', oi.quantity, 'totalPrice', oi.total_price
    ) ORDER BY oi.created_at, oi.id) FROM order_items oi WHERE oi.order_id = o.id),
    '[]'
  ) AS items
`;

export const ordersRepository = {
  async listForUser(userId: string, limit: number, offset: number) {
    const countResult = await query<{ count: string }>('SELECT COUNT(*)::text AS count FROM orders WHERE user_id = $1', [userId]);
    const dataResult = await query(
      `SELECT o.*, ${ORDER_ITEMS_SUBQUERY}
       FROM orders o
       WHERE o.user_id = $1
       ORDER BY o.created_at DESC, o.id ASC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );
    return { rows: dataResult.rows, total: parseInt(countResult.rows[0].count, 10) };
  },

  async findByOrderNumberForUser(userId: string, orderNumber: string) {
    const result = await query(
      `SELECT o.*, ${ORDER_ITEMS_SUBQUERY}
       FROM orders o
       WHERE o.order_number = $1 AND o.user_id = $2`,
      [orderNumber, userId]
    );
    const order = result.rows[0];
    if (!order) return null;
    const history = await query(
      'SELECT status, note, created_at FROM order_status_history WHERE order_id = $1 ORDER BY created_at ASC, id ASC',
      [order.id]
    );
    return { ...order, statusHistory: history.rows };
  },

  // ---- Admin ----
  async adminList(params: { limit: number; offset: number; status?: string; paymentStatus?: string; search?: string }) {
    const clauses: string[] = [];
    const values: unknown[] = [];

    if (params.status) {
      values.push(params.status);
      clauses.push(`o.status = $${values.length}`);
    }
    if (params.paymentStatus) {
      values.push(params.paymentStatus);
      clauses.push(`o.payment_status = $${values.length}`);
    }
    if (params.search) {
      values.push(`%${escapeLike(params.search)}%`);
      clauses.push(`(o.order_number ILIKE $${values.length} OR u.email ILIKE $${values.length} OR u.name ILIKE $${values.length})`);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

    const countResult = await query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM orders o JOIN users u ON u.id = o.user_id ${where}`,
      values
    );

    values.push(params.limit, params.offset);
    const dataResult = await query(
      `SELECT o.*, u.name AS customer_name, u.email AS customer_email
       FROM orders o
       JOIN users u ON u.id = o.user_id
       ${where}
       ORDER BY o.created_at DESC, o.id ASC
       LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values
    );
    return { rows: dataResult.rows, total: parseInt(countResult.rows[0].count, 10) };
  },

  async adminFindById(id: string) {
    const result = await query(
      `SELECT o.*, u.name AS customer_name, u.email AS customer_email, ${ORDER_ITEMS_SUBQUERY}
       FROM orders o
       JOIN users u ON u.id = o.user_id
       WHERE o.id = $1`,
      [id]
    );
    if (!result.rows[0]) return null;

    const historyResult = await query(
      `SELECT osh.*, u.name AS changed_by_name
       FROM order_status_history osh
       LEFT JOIN users u ON u.id = osh.changed_by
       WHERE osh.order_id = $1
       ORDER BY osh.created_at ASC, osh.id ASC`,
      [id]
    );
    const payments = await query(
      'SELECT id, provider, status, amount, transaction_id, created_at FROM payments WHERE order_id = $1 ORDER BY created_at ASC',
      [id]
    );
    return { ...result.rows[0], statusHistory: historyResult.rows, payments: payments.rows };
  },

  async idByOrderNumberForUser(userId: string, orderNumber: string): Promise<string | null> {
    const r = await query<{ id: string }>('SELECT id FROM orders WHERE order_number = $1 AND user_id = $2', [orderNumber, userId]);
    return r.rows[0]?.id ?? null;
  },

  // ---- transactional helpers (used by the status-change workflow) ----
  async lockOrder(client: PoolClient, id: string) {
    const r = await client.query('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [id]);
    return r.rows[0] ?? null;
  },

  async setStatus(client: PoolClient, id: string, status: string) {
    const r = await client.query('UPDATE orders SET status = $2, updated_at = now() WHERE id = $1 RETURNING *', [id, status]);
    return r.rows[0];
  },

  async setPaymentStatus(client: PoolClient, id: string, paymentStatus: string) {
    await client.query('UPDATE orders SET payment_status = $2, updated_at = now() WHERE id = $1', [id, paymentStatus]);
  },

  async setLatestPaymentRow(client: PoolClient, orderId: string, status: string, transactionId?: string | null) {
    await client.query(
      `UPDATE payments SET status = $2, transaction_id = COALESCE($3, transaction_id)
       WHERE id = (SELECT id FROM payments WHERE order_id = $1 ORDER BY created_at DESC LIMIT 1)`,
      [orderId, status, transactionId ?? null]
    );
  },

  async addStatusHistory(client: PoolClient, orderId: string, status: string, changedBy: string, note?: string) {
    await client.query(
      'INSERT INTO order_status_history (order_id, status, note, changed_by) VALUES ($1,$2,$3,$4)',
      [orderId, status, note ?? null, changedBy]
    );
  },

  async itemsForRestock(client: PoolClient, orderId: string) {
    const r = await client.query(
      'SELECT product_id, variant_id, quantity FROM order_items WHERE order_id = $1 AND variant_id IS NOT NULL ORDER BY variant_id',
      [orderId]
    );
    return r.rows as { product_id: string; variant_id: string; quantity: number }[];
  },

  async restockVariant(client: PoolClient, variantId: string, quantity: number) {
    const r = await client.query(
      `UPDATE product_variants SET stock_quantity = stock_quantity + $2, updated_at = now()
       WHERE id = $1 RETURNING stock_quantity`,
      [variantId, quantity]
    );
    return r.rows[0] as { stock_quantity: number } | undefined;
  },

  async addMovement(
    client: PoolClient,
    m: { productId: string; variantId: string; previous: number; next: number; reason: string; note: string; adminId?: string | null }
  ) {
    await client.query(
      `INSERT INTO inventory_movements
        (product_id, variant_id, previous_quantity, new_quantity, change_quantity, reason, note, admin_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [m.productId, m.variantId, m.previous, m.next, m.next - m.previous, m.reason, m.note, m.adminId ?? null]
    );
  },

  async updateAdminNote(id: string, note: string | null) {
    const result = await query(
      'UPDATE orders SET admin_note = $2, updated_at = now() WHERE id = $1 RETURNING *',
      [id, note]
    );
    return result.rows[0] ?? null;
  },
};
