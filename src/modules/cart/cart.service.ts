import { withTransaction } from '../../config/db';
import { BadRequestError, NotFoundError, UnprocessableEntityError } from '../../utils/errors';
import { round2, unitPriceFor } from '../../utils/pricing';
import { cartRepository, PurchaseTarget } from './cart.repository';

interface CartItemRow {
  id: string;
  product_id: string;
  variant_id: string | null;
  quantity: number;
  product_name: string;
  product_slug: string;
  product_status: string;
  product_stock_status: string;
  base_price: string;
  sale_price: string | null;
  catalog_visible: boolean;
  active_variant_count: number;
  variant_name: string | null;
  variant_price: string | null;
  variant_sale_price: string | null;
  variant_stock: number | null;
  variant_status: string | null;
  image_url: string | null;
}

/** null stock = not tracked numerically (product without variants). */
interface Purchasable {
  stock: number | null;
}

/**
 * Single rule-set for "may this product/variant be bought". Used by the cart AND checkout,
 * so the two can never disagree (this was the root of the unlimited-stock bypass).
 */
export function assessTarget(target: PurchaseTarget, variantId: string | null): Purchasable {
  const { product, variant } = target;
  if (!product || product.status !== 'published' || product.category_active === false || product.brand_active === false) {
    throw new NotFoundError('This product is no longer available');
  }
  if (variantId) {
    if (!variant || variant.status !== 'active') {
      throw new BadRequestError('The selected option is not available');
    }
    return { stock: variant.stock_quantity };
  }
  if (product.active_variant_count > 0) {
    throw new BadRequestError('Please choose an option (size, shade, etc.) for this product');
  }
  if (product.stock_status === 'out_of_stock' || product.stock_status === 'discontinued') {
    throw new UnprocessableEntityError('This product is out of stock');
  }
  return { stock: null };
}

function assertQuantity(stock: number | null, desiredTotal: number): void {
  if (stock === null) return;
  if (stock <= 0) throw new UnprocessableEntityError('This item is out of stock');
  if (desiredTotal > stock) throw new UnprocessableEntityError(`Only ${stock} left in stock`);
}

function serializeCart(rows: CartItemRow[]) {
  const items = rows.map((row) => {
    const price = unitPriceFor(
      { base_price: row.base_price, sale_price: row.sale_price },
      row.variant_id ? { price: row.variant_price, sale_price: row.variant_sale_price } : null
    );
    const stock = row.variant_id ? row.variant_stock : null;

    let warning: string | null = null;
    if (row.product_status !== 'published' || !row.catalog_visible) warning = 'This product is no longer available';
    else if (row.variant_id && row.variant_status !== 'active') warning = 'This option is no longer available';
    else if (!row.variant_id && row.active_variant_count > 0) warning = 'Please remove this item and choose an option';
    else if (!row.variant_id && ['out_of_stock', 'discontinued'].includes(row.product_stock_status)) warning = 'This item is out of stock';
    else if (stock !== null && stock < row.quantity) warning = stock <= 0 ? 'This item is out of stock' : `Only ${stock} left in stock`;
    else if (price <= 0) warning = 'This item is currently unavailable';

    return {
      id: row.id,
      productId: row.product_id,
      variantId: row.variant_id,
      slug: row.product_slug,
      name: row.product_name,
      variantName: row.variant_name,
      image: row.image_url,
      price,
      quantity: row.quantity,
      subtotal: round2(price * row.quantity),
      stockAvailable: stock,
      isAvailable: warning === null,
      warning,
    };
  });

  return {
    items,
    itemCount: items.reduce((sum, i) => sum + i.quantity, 0),
    subtotal: round2(items.filter((i) => i.isAvailable).reduce((sum, i) => sum + i.subtotal, 0)),
    hasIssues: items.some((i) => !i.isAvailable),
  };
}

type AddInput = { productId: string; variantId?: string | null; quantity: number };

export const cartService = {
  async getCart(userId: string) {
    const cart = await cartRepository.findOrCreateCart(userId);
    return serializeCart((await cartRepository.getItemsWithProductInfo(cart.id)) as CartItemRow[]);
  },

  async addItem(userId: string, input: AddInput) {
    const variantId = input.variantId ?? null;
    const cart = await cartRepository.findOrCreateCart(userId);
    const target = await cartRepository.lookupTarget(input.productId, variantId);
    const { stock } = assessTarget(target, variantId);
    const existing = await cartRepository.findItem(cart.id, input.productId, variantId);
    assertQuantity(stock, (existing?.quantity ?? 0) + input.quantity);
    await cartRepository.upsertItem(cart.id, input.productId, variantId, input.quantity);
    return serializeCart((await cartRepository.getItemsWithProductInfo(cart.id)) as CartItemRow[]);
  },

  async updateItemQuantity(userId: string, itemId: string, quantity: number) {
    const cart = await cartRepository.findOrCreateCart(userId);
    const existing = await cartRepository.findItemById(cart.id, itemId);
    if (!existing) throw new NotFoundError('Cart item not found');
    const target = await cartRepository.lookupTarget(existing.product_id, existing.variant_id);
    const { stock } = assessTarget(target, existing.variant_id);
    assertQuantity(stock, quantity);
    await cartRepository.updateItemQuantity(cart.id, itemId, quantity);
    return serializeCart((await cartRepository.getItemsWithProductInfo(cart.id)) as CartItemRow[]);
  },

  async removeItem(userId: string, itemId: string) {
    const cart = await cartRepository.findOrCreateCart(userId);
    if (!(await cartRepository.removeItem(cart.id, itemId))) throw new NotFoundError('Cart item not found');
    return serializeCart((await cartRepository.getItemsWithProductInfo(cart.id)) as CartItemRow[]);
  },

  async clearCart(userId: string) {
    const cart = await cartRepository.findOrCreateCart(userId);
    await cartRepository.clearCart(cart.id);
    return serializeCart([]);
  },

  /**
   * Merges a guest (localStorage) cart into the user's cart in ONE transaction.
   * Unavailable items are skipped (and reported) instead of failing the whole merge;
   * quantities are clamped to stock.
   */
  async syncCart(userId: string, items: AddInput[]) {
    if (!Array.isArray(items)) throw new BadRequestError('items must be an array');
    return withTransaction(async (client) => {
      const cart = await cartRepository.findOrCreateCart(userId, client);
      const skipped: { productId: string; variantId: string | null; reason: string }[] = [];

      for (const item of items) {
        const variantId = item.variantId ?? null;
        try {
          const target = await cartRepository.lookupTarget(item.productId, variantId, client);
          const { stock } = assessTarget(target, variantId);
          const existing = await cartRepository.findItem(cart.id, item.productId, variantId, client);
          let qty = item.quantity;
          if (stock !== null) qty = Math.min(qty, stock - (existing?.quantity ?? 0));
          if (qty <= 0) throw new UnprocessableEntityError('Already at the maximum available quantity');
          await cartRepository.upsertItem(cart.id, item.productId, variantId, qty, client);
        } catch (err) {
          if (err instanceof BadRequestError || err instanceof NotFoundError || err instanceof UnprocessableEntityError) {
            skipped.push({ productId: item.productId, variantId, reason: err.message });
          } else {
            throw err;
          }
        }
      }
      const rows = (await cartRepository.getItemsWithProductInfo(cart.id, client)) as CartItemRow[];
      return { cart: serializeCart(rows), skipped };
    });
  },
};
