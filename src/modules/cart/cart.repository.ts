import { PoolClient } from 'pg';
import { query } from '../../config/db';
import { env } from '../../config/env';

type Runner = Pick<PoolClient, 'query'>;
const run = (runner: Runner | null, text: string, params: unknown[]) =>
  runner ? runner.query(text, params) : query(text, params);

export interface PurchaseTarget {
  product: {
    id: string;
    status: string;
    stock_status: string;
    category_active: boolean | null;
    brand_active: boolean | null;
    active_variant_count: number;
  } | null;
  variant: { id: string; status: string; stock_quantity: number } | null;
}

export const cartRepository = {
  async findOrCreateCart(userId: string, runner: Runner | null = null) {
    const existing = await run(runner, 'SELECT * FROM carts WHERE user_id = $1', [userId]);
    if (existing.rowCount) return existing.rows[0];
    // ON CONFLICT covers two requests creating the first cart at the same time.
    const created = await run(
      runner,
      `INSERT INTO carts (user_id) VALUES ($1)
       ON CONFLICT (user_id) DO UPDATE SET updated_at = now() RETURNING *`,
      [userId]
    );
    return created.rows[0];
  },

  async getItemsWithProductInfo(cartId: string, runner: Runner | null = null) {
    const result = await run(
      runner,
      `SELECT
        ci.id, ci.cart_id, ci.product_id, ci.variant_id, ci.quantity,
        p.name AS product_name, p.slug AS product_slug, p.status AS product_status,
        p.stock_status AS product_stock_status,
        p.base_price, p.sale_price, p.currency,
        (c.is_active IS NOT FALSE AND (b.id IS NULL OR b.is_active)) AS catalog_visible,
        (SELECT COUNT(*)::int FROM product_variants pv WHERE pv.product_id = p.id AND pv.status = 'active') AS active_variant_count,
        v.name AS variant_name, v.price AS variant_price, v.sale_price AS variant_sale_price,
        v.stock_quantity AS variant_stock, v.status AS variant_status,
        (SELECT pi.url FROM product_images pi
         WHERE pi.product_id = p.id AND (pi.variant_id = ci.variant_id OR pi.variant_id IS NULL)
         ORDER BY (pi.variant_id IS NOT NULL) DESC, pi.is_main DESC, pi.sort_order ASC LIMIT 1) AS image_url
       FROM cart_items ci
       JOIN products p ON p.id = ci.product_id
       LEFT JOIN categories c ON c.id = p.category_id
       LEFT JOIN brands b ON b.id = p.brand_id
       LEFT JOIN product_variants v ON v.id = ci.variant_id AND v.product_id = ci.product_id
       WHERE ci.cart_id = $1
       ORDER BY ci.created_at ASC, ci.id ASC`,
      [cartId]
    );
    return result.rows;
  },

  /** Everything needed to decide whether a product/variant can be bought right now. */
  async lookupTarget(productId: string, variantId: string | null, runner: Runner | null = null): Promise<PurchaseTarget> {
    const p = await run(
      runner,
      `SELECT p.id, p.status, p.stock_status,
              c.is_active AS category_active, b.is_active AS brand_active,
              (SELECT COUNT(*)::int FROM product_variants pv WHERE pv.product_id = p.id AND pv.status = 'active') AS active_variant_count
       FROM products p
       LEFT JOIN categories c ON c.id = p.category_id
       LEFT JOIN brands b ON b.id = p.brand_id
       WHERE p.id = $1`,
      [productId]
    );
    let variant = null;
    if (variantId) {
      const v = await run(
        runner,
        'SELECT id, status, stock_quantity FROM product_variants WHERE id = $1 AND product_id = $2',
        [variantId, productId]
      );
      variant = v.rows[0] ?? null;
    }
    return { product: p.rows[0] ?? null, variant };
  },

  async findItem(cartId: string, productId: string, variantId: string | null, runner: Runner | null = null) {
    const result = await run(
      runner,
      `SELECT * FROM cart_items
       WHERE cart_id = $1 AND product_id = $2 AND variant_id IS NOT DISTINCT FROM $3`,
      [cartId, productId, variantId]
    );
    return result.rows[0] ?? null;
  },

  async findItemById(cartId: string, itemId: string) {
    const result = await query('SELECT * FROM cart_items WHERE id = $1 AND cart_id = $2', [itemId, cartId]);
    return result.rows[0] ?? null;
  },

  /**
   * Adds quantity to a line (capped). Items without a variant need their own conflict target:
   * NULLs are distinct in a plain UNIQUE constraint, so a partial unique index handles them.
   */
  async upsertItem(
    cartId: string,
    productId: string,
    variantId: string | null,
    quantity: number,
    runner: Runner | null = null
  ) {
    const max = env.MAX_CART_QUANTITY;
    const text = variantId
      ? `INSERT INTO cart_items (cart_id, product_id, variant_id, quantity)
         VALUES ($1,$2,$3,LEAST($4, ${max}))
         ON CONFLICT (cart_id, product_id, variant_id)
         DO UPDATE SET quantity = LEAST(cart_items.quantity + EXCLUDED.quantity, ${max}), updated_at = now()
         RETURNING *`
      : `INSERT INTO cart_items (cart_id, product_id, variant_id, quantity)
         VALUES ($1,$2,NULL,LEAST($3::int, ${max}))
         ON CONFLICT (cart_id, product_id) WHERE variant_id IS NULL
         DO UPDATE SET quantity = LEAST(cart_items.quantity + EXCLUDED.quantity, ${max}), updated_at = now()
         RETURNING *`;
    const params = variantId ? [cartId, productId, variantId, quantity] : [cartId, productId, quantity];
    const result = await run(runner, text, params);
    return result.rows[0];
  },

  async updateItemQuantity(cartId: string, itemId: string, quantity: number) {
    const result = await query(
      `UPDATE cart_items SET quantity = $3, updated_at = now()
       WHERE id = $1 AND cart_id = $2 RETURNING *`,
      [itemId, cartId, quantity]
    );
    return result.rows[0] ?? null;
  },

  async removeItem(cartId: string, itemId: string) {
    const result = await query('DELETE FROM cart_items WHERE id = $1 AND cart_id = $2 RETURNING id', [itemId, cartId]);
    return result.rows[0] ?? null;
  },

  async clearCart(cartId: string, runner: Runner | null = null) {
    await run(runner, 'DELETE FROM cart_items WHERE cart_id = $1', [cartId]);
  },
};
