import { PoolClient } from 'pg';
import crypto from 'crypto';

export function generateOrderNumber(): string {
  const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const randomPart = crypto.randomBytes(4).toString('hex').toUpperCase();
  return `SNS-${datePart}-${randomPart}`;
}

export const checkoutRepository = {
  /** lock=true takes a row lock on the cart so two concurrent checkouts can't both consume it. */
  async getCartWithItems(client: PoolClient, userId: string, lock: boolean) {
    const cartResult = await client.query(
      `SELECT * FROM carts WHERE user_id = $1 ${lock ? 'FOR UPDATE' : ''}`,
      [userId]
    );
    if (!cartResult.rowCount) return { cart: null, items: [] };
    const cart = cartResult.rows[0];
    // Deterministic order => every transaction locks products in the same order (no deadlocks).
    const itemsResult = await client.query(
      `SELECT * FROM cart_items WHERE cart_id = $1
       ORDER BY product_id ASC, variant_id ASC NULLS FIRST, id ASC`,
      [cart.id]
    );
    return { cart, items: itemsResult.rows };
  },

  async lockProductAndVariant(client: PoolClient, productId: string, variantId: string | null, lock: boolean) {
    // Products are only read here, so a shared lock suffices (and lets buyers of the same product proceed in parallel).
    const productResult = await client.query(
      `SELECT p.id, p.name, p.status, p.stock_status, p.base_price, p.sale_price, p.currency, p.sku,
              c.is_active AS category_active, b.is_active AS brand_active,
              (SELECT COUNT(*)::int FROM product_variants pv WHERE pv.product_id = p.id AND pv.status = 'active') AS active_variant_count
       FROM products p
       LEFT JOIN categories c ON c.id = p.category_id
       LEFT JOIN brands b ON b.id = p.brand_id
       WHERE p.id = $1 ${lock ? 'FOR SHARE OF p' : ''}`,
      [productId]
    );
    const product = productResult.rows[0] ?? null;

    let variant = null;
    if (variantId) {
      const variantResult = await client.query(
        `SELECT id, name, price, sale_price, stock_quantity, status, sku
         FROM product_variants WHERE id = $1 AND product_id = $2 ${lock ? 'FOR UPDATE' : ''}`,
        [variantId, productId]
      );
      variant = variantResult.rows[0] ?? null;
    }

    return { product, variant };
  },

  async decrementVariantStock(client: PoolClient, variantId: string, quantity: number) {
    const result = await client.query(
      `UPDATE product_variants
       SET stock_quantity = stock_quantity - $2, updated_at = now()
       WHERE id = $1 AND stock_quantity >= $2
       RETURNING stock_quantity`,
      [variantId, quantity]
    );
    return result.rows[0];
  },

  async findAddress(client: PoolClient, userId: string, addressId: string) {
    const result = await client.query(
      'SELECT * FROM addresses WHERE id = $1 AND user_id = $2',
      [addressId, userId]
    );
    return result.rows[0] ?? null;
  },

  async createOrder(
    client: PoolClient,
    input: {
      userId: string;
      orderNumber: string;
      subtotal: number;
      discountTotal: number;
      deliveryFee: number;
      total: number;
      currency: string;
      couponId: string | null;
      paymentProvider: string;
      customerNote?: string;
      shippingAddress: Record<string, unknown>;
    }
  ) {
    const result = await client.query(
      `INSERT INTO orders
        (user_id, order_number, status, payment_status, subtotal, discount_total, delivery_fee, total,
         currency, coupon_id, customer_note, shipping_address, payment_provider)
       VALUES ($1,$2,'pending','unpaid',$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING *`,
      [
        input.userId, input.orderNumber, input.subtotal, input.discountTotal,
        input.deliveryFee, input.total, input.currency, input.couponId ?? null,
        input.customerNote ?? null, JSON.stringify(input.shippingAddress), input.paymentProvider,
      ]
    );
    return result.rows[0];
  },

  async createOrderItem(
    client: PoolClient,
    input: {
      orderId: string;
      productId: string;
      variantId: string | null;
      productName: string;
      variantName: string | null;
      sku: string | null;
      unitPrice: number;
      quantity: number;
      totalPrice: number;
      snapshot: Record<string, unknown>;
    }
  ) {
    await client.query(
      `INSERT INTO order_items
        (order_id, product_id, variant_id, product_name, variant_name, sku, unit_price, quantity, total_price, snapshot)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        input.orderId, input.productId, input.variantId, input.productName, input.variantName,
        input.sku, input.unitPrice, input.quantity, input.totalPrice, JSON.stringify(input.snapshot),
      ]
    );
  },

  async createInventoryMovement(
    client: PoolClient,
    input: {
      productId: string;
      variantId: string;
      previousQuantity: number;
      newQuantity: number;
      changeQuantity: number;
      reason: string;
      note?: string;
    }
  ) {
    await client.query(
      `INSERT INTO inventory_movements
        (product_id, variant_id, previous_quantity, new_quantity, change_quantity, reason, note)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        input.productId, input.variantId, input.previousQuantity, input.newQuantity,
        input.changeQuantity, input.reason, input.note ?? null,
      ]
    );
  },

  async createPayment(
    client: PoolClient,
    input: { orderId: string; provider: string; amount: number }
  ) {
    await client.query(
      `INSERT INTO payments (order_id, provider, status, amount)
       VALUES ($1,$2,'pending',$3)`,
      [input.orderId, input.provider, input.amount]
    );
  },

  async createStatusHistory(
    client: PoolClient,
    input: { orderId: string; status: string; note?: string; changedBy?: string }
  ) {
    await client.query(
      `INSERT INTO order_status_history (order_id, status, note, changed_by)
       VALUES ($1,$2,$3,$4)`,
      [input.orderId, input.status, input.note ?? null, input.changedBy ?? null]
    );
  },

  async clearCartItems(client: PoolClient, cartId: string) {
    await client.query('DELETE FROM cart_items WHERE cart_id = $1', [cartId]);
  },
};
