import { PoolClient } from 'pg';
import { withTransaction } from '../../config/db';
import { env } from '../../config/env';
import { BadRequestError, NotFoundError, UnprocessableEntityError } from '../../utils/errors';
import { round2, unitPriceFor } from '../../utils/pricing';
import { syncProductStockStatus } from '../../utils/stockStatus';
import { assessTarget } from '../cart/cart.service';
import { couponsService } from '../coupons/coupons.service';
import { getSettings } from '../settings/settings.service';
import { checkoutRepository, generateOrderNumber } from './checkout.repository';

interface PlaceOrderInput {
  addressId: string;
  couponCode?: string;
  paymentProvider: string;
  customerNote?: string;
}

interface PreparedItem {
  productId: string;
  variantId: string | null;
  productName: string;
  variantName: string | null;
  sku: string | null;
  unitPrice: number;
  quantity: number;
  totalPrice: number;
  previousStock: number | null;
}

/** Shipping is decided here, never by the client. */
export async function computeDeliveryFee(subtotal: number): Promise<{ fee: number; freeAbove: number }> {
  const s = await getSettings(); // admin-editable (falls back to the environment defaults)
  if (s.deliveryFee <= 0) return { fee: 0, freeAbove: 0 };
  const free = s.freeDeliveryThreshold > 0 && subtotal > s.freeDeliveryThreshold;
  return { fee: free ? 0 : round2(s.deliveryFee), freeAbove: s.freeDeliveryThreshold };
}

/**
 * Re-prices and re-validates the cart straight from the database (never trusting the client).
 * `lock` = true is the real checkout: cart/product/variant rows are locked for the transaction.
 */
async function prepare(client: PoolClient, userId: string, lock: boolean) {
  const { cart, items } = await checkoutRepository.getCartWithItems(client, userId, lock);
  if (!cart || items.length === 0) throw new BadRequestError('Your cart is empty');

  let subtotal = 0;
  const prepared: PreparedItem[] = [];

  for (const item of items) {
    const { product, variant } = await checkoutRepository.lockProductAndVariant(
      client, item.product_id, item.variant_id, lock
    );

    // Same rules as add-to-cart: published, visible, option chosen, not out of stock...
    try {
      assessTarget(
        {
          product: product && {
            id: product.id,
            status: product.status,
            stock_status: product.stock_status,
            category_active: product.category_active,
            brand_active: product.brand_active,
            active_variant_count: product.active_variant_count,
          },
          variant: variant && { id: variant.id, status: variant.status, stock_quantity: variant.stock_quantity },
        },
        item.variant_id
      );
    } catch (err) {
      const label = product?.name ? `"${product.name}"` : 'An item in your cart';
      throw new UnprocessableEntityError(`${label}: ${(err as Error).message}. Please update your cart.`);
    }

    if (variant && variant.stock_quantity < item.quantity) {
      throw new UnprocessableEntityError(
        `Insufficient stock for "${product.name}"${variant.name ? ` (${variant.name})` : ''}. Only ${variant.stock_quantity} left.`
      );
    }

    const unitPrice = unitPriceFor(product, variant);
    if (!(unitPrice > 0)) {
      throw new UnprocessableEntityError(`"${product.name}" is currently unavailable for purchase`);
    }
    const totalPrice = round2(unitPrice * item.quantity);
    subtotal += totalPrice;

    prepared.push({
      productId: product.id,
      variantId: item.variant_id,
      productName: product.name,
      variantName: variant?.name ?? null,
      sku: variant?.sku ?? product.sku ?? null,
      unitPrice,
      quantity: item.quantity,
      totalPrice,
      previousStock: variant ? variant.stock_quantity : null,
    });
  }

  return { cart, prepared, subtotal: round2(subtotal) };
}

export const checkoutService = {
  /** Server-authoritative price breakdown for the checkout page. Nothing is reserved or charged. */
  async quote(userId: string, couponCode?: string) {
    return withTransaction(async (client) => {
      const { subtotal } = await prepare(client, userId, false);

      let discountTotal = 0;
      let couponError: string | null = null;
      let appliedCode: string | null = null;
      if (couponCode) {
        try {
          const { coupon, discount } = await couponsService.preview(couponCode, subtotal, userId);
          discountTotal = discount;
          appliedCode = coupon.code;
        } catch (err) {
          couponError = (err as Error).message;
        }
      }
      const { fee: deliveryFee, freeAbove } = await computeDeliveryFee(subtotal);
      return {
        subtotal,
        discountTotal,
        deliveryFee,
        total: round2(subtotal - discountTotal + deliveryFee),
        currency: env.DEFAULT_CURRENCY,
        couponCode: appliedCode,
        couponError,
        freeDeliveryThreshold: freeAbove,
        paymentProviders: env.PAYMENT_PROVIDERS,
      };
    });
  },

  async placeOrder(userId: string, input: PlaceOrderInput) {
    return withTransaction(async (client) => {
      const { cart, prepared, subtotal } = await prepare(client, userId, true);

      const address = await checkoutRepository.findAddress(client, userId, input.addressId);
      if (!address) throw new NotFoundError('Delivery address not found');

      let discountTotal = 0;
      let couponId: string | null = null;
      if (input.couponCode) {
        const applied = await couponsService.applyWithinTransaction(client, input.couponCode, subtotal, userId);
        discountTotal = applied.discount;
        couponId = applied.couponId;
      }

      const { fee: deliveryFee } = await computeDeliveryFee(subtotal);
      const total = round2(subtotal - discountTotal + deliveryFee);

      const orderNumber = generateOrderNumber();
      const order = await checkoutRepository.createOrder(client, {
        userId,
        orderNumber,
        subtotal,
        discountTotal,
        deliveryFee,
        total,
        currency: env.DEFAULT_CURRENCY,
        couponId,
        paymentProvider: input.paymentProvider,
        customerNote: input.customerNote,
        shippingAddress: {
          fullName: address.full_name,
          phone: address.phone,
          addressLine1: address.address_line_1,
          addressLine2: address.address_line_2,
          city: address.city,
          zone: address.zone,
          postalCode: address.postal_code,
          country: address.country,
        },
      });

      const touchedProducts = new Set<string>();
      for (const item of prepared) {
        await checkoutRepository.createOrderItem(client, {
          orderId: order.id,
          productId: item.productId,
          variantId: item.variantId,
          productName: item.productName,
          variantName: item.variantName,
          sku: item.sku,
          unitPrice: item.unitPrice,
          quantity: item.quantity,
          totalPrice: item.totalPrice,
          snapshot: { ...item },
        });

        if (item.variantId && item.previousStock !== null) {
          const updated = await checkoutRepository.decrementVariantStock(client, item.variantId, item.quantity);
          if (!updated) throw new UnprocessableEntityError(`"${item.productName}" just sold out. Please update your cart.`);
          await checkoutRepository.createInventoryMovement(client, {
            productId: item.productId,
            variantId: item.variantId,
            previousQuantity: item.previousStock,
            newQuantity: item.previousStock - item.quantity,
            changeQuantity: -item.quantity,
            reason: 'order_placed',
            note: `Order ${orderNumber}`,
          });
          touchedProducts.add(item.productId);
        }
      }
      for (const productId of touchedProducts) await syncProductStockStatus(client, productId);

      await checkoutRepository.createPayment(client, { orderId: order.id, provider: input.paymentProvider, amount: total });
      await checkoutRepository.createStatusHistory(client, {
        orderId: order.id, status: 'pending', note: 'Order placed', changedBy: userId,
      });
      await checkoutRepository.clearCartItems(client, cart.id);

      return {
        id: order.id,
        orderNumber: order.order_number,
        status: order.status,
        paymentStatus: order.payment_status,
        paymentProvider: input.paymentProvider,
        subtotal,
        discountTotal,
        deliveryFee,
        total,
        currency: order.currency,
        createdAt: order.created_at,
      };
    });
  },
};
