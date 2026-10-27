import { withTransaction, query } from '../../../config/db';
import { getSettings } from '../../settings/settings.service';
import { NotFoundError } from '../../../utils/errors';
import { escapeLike } from '../../../utils/sql';
import { syncProductStockStatus } from '../../../utils/stockStatus';

export const inventoryRepository = {
  async listStock(limit: number, offset: number, opts: { search?: string; lowStockOnly?: boolean } = {}) {
    const clauses: string[] = [];
    const values: unknown[] = [];
    if (opts.search) {
      values.push(`%${escapeLike(opts.search)}%`);
      clauses.push(`(p.name ILIKE $${values.length} OR v.name ILIKE $${values.length} OR v.sku ILIKE $${values.length})`);
    }
    if (opts.lowStockOnly) {
      values.push((await getSettings()).lowStockThreshold);
      clauses.push(`v.stock_quantity <= $${values.length}`);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const countResult = await query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM product_variants v JOIN products p ON p.id = v.product_id ${where}`,
      values
    );
    values.push(limit, offset);
    const dataResult = await query(
      `SELECT v.id AS variant_id, v.name AS variant_name, v.sku, v.stock_quantity, v.status,
              p.id AS product_id, p.name AS product_name, p.slug AS product_slug, p.stock_status
       FROM product_variants v
       JOIN products p ON p.id = v.product_id
       ${where}
       ORDER BY v.stock_quantity ASC, p.name ASC, v.id ASC
       LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values
    );
    return { rows: dataResult.rows, total: parseInt(countResult.rows[0].count, 10) };
  },

  async lowStock(thresholdOverride?: number, limit = 50) {
    const threshold = thresholdOverride ?? (await getSettings()).lowStockThreshold;
    const result = await query(
      `SELECT v.id AS variant_id, v.name AS variant_name, v.sku, v.stock_quantity,
              p.id AS product_id, p.name AS product_name, p.slug AS product_slug
       FROM product_variants v
       JOIN products p ON p.id = v.product_id
       WHERE v.stock_quantity <= $1 AND v.status = 'active'
       ORDER BY v.stock_quantity ASC, v.id ASC
       LIMIT $2`,
      [threshold, limit]
    );
    return result.rows;
  },

  async movements(limit: number, offset: number, productId?: string) {
    const clauses: string[] = [];
    const values: unknown[] = [];
    if (productId) {
      values.push(productId);
      clauses.push(`im.product_id = $${values.length}`);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

    const countResult = await query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM inventory_movements im ${where}`,
      values
    );

    values.push(limit, offset);
    const dataResult = await query(
      `SELECT im.*, p.name AS product_name, v.name AS variant_name, u.name AS admin_name
       FROM inventory_movements im
       JOIN products p ON p.id = im.product_id
       LEFT JOIN product_variants v ON v.id = im.variant_id
       LEFT JOIN users u ON u.id = im.admin_id
       ${where}
       ORDER BY im.created_at DESC, im.id ASC
       LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values
    );
    return { rows: dataResult.rows, total: parseInt(countResult.rows[0].count, 10) };
  },

  /**
   * Adjusts a variant's stock to an exact new quantity inside a transaction,
   * recording the movement for audit purposes.
   */
  async adjustStock(input: {
    productId: string;
    variantId: string;
    newQuantity: number;
    reason: string;
    note?: string;
    adminId: string;
  }) {
    return withTransaction(async (client) => {
      const current = await client.query(
        'SELECT stock_quantity FROM product_variants WHERE id = $1 AND product_id = $2 FOR UPDATE',
        [input.variantId, input.productId]
      );
      if (!current.rowCount) {
        throw new NotFoundError('Product variant not found');
      }
      const previousQuantity = current.rows[0].stock_quantity;

      await client.query(
        'UPDATE product_variants SET stock_quantity = $1, updated_at = now() WHERE id = $2',
        [input.newQuantity, input.variantId]
      );

      await client.query(
        `INSERT INTO inventory_movements
          (product_id, variant_id, previous_quantity, new_quantity, change_quantity, reason, note, admin_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          input.productId, input.variantId, previousQuantity, input.newQuantity,
          input.newQuantity - previousQuantity, input.reason, input.note ?? null, input.adminId,
        ]
      );

      await syncProductStockStatus(client, input.productId);
      return { previousQuantity, newQuantity: input.newQuantity };
    });
  },
};
