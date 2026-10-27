import { withTransaction } from '../../config/db';
import { BadRequestError, ConflictError, NotFoundError } from '../../utils/errors';
import { buildPaginationMeta, parsePagination } from '../../utils/pagination';
import { syncProductStockStatus } from '../../utils/stockStatus';
import { couponsService } from '../coupons/coupons.service';
import { ordersRepository } from './orders.repository';

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Allowed order status transitions. Terminal states have no outgoing edges. */
export const ORDER_TRANSITIONS: Record<string, string[]> = {
  pending: ['confirmed', 'cancelled', 'failed_payment'],
  failed_payment: ['pending', 'cancelled'],
  confirmed: ['processing', 'cancelled'],
  processing: ['packed', 'cancelled'],
  packed: ['shipped', 'cancelled'],
  shipped: ['delivered', 'returned'],
  delivered: ['returned'],
  returned: ['refunded'],
  cancelled: [],
  refunded: [],
};

const CUSTOMER_CANCELLABLE = ['pending', 'confirmed'];

const num = (v: unknown) => (v === null || v === undefined ? v : Number(v));

function moneyFields(row: Row) {
  return {
    subtotal: num(row.subtotal),
    discount_total: num(row.discount_total),
    delivery_fee: num(row.delivery_fee),
    total: num(row.total),
  };
}

/** Customer-facing order: no admin_note, user_id or coupon_id; money as numbers. */
function toCustomerOrder(row: Row) {
  return {
    id: row.id,
    order_number: row.order_number,
    status: row.status,
    payment_status: row.payment_status,
    payment_provider: row.payment_provider,
    ...moneyFields(row),
    currency: row.currency,
    customer_note: row.customer_note,
    shipping_address: row.shipping_address,
    items: row.items ?? [],
    status_history: row.statusHistory ?? undefined,
    can_cancel: CUSTOMER_CANCELLABLE.includes(row.status),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function toAdminOrder(row: Row): Row {
  return { ...row, ...moneyFields(row) };
}

type ChangeOptions = {
  changedBy: string;
  note?: string;
  /** when set, the order must belong to this user and be customer-cancellable */
  customerUserId?: string;
};

async function changeStatus(orderId: string, newStatus: string, opts: ChangeOptions) {
  return withTransaction(async (client) => {
    const order = await ordersRepository.lockOrder(client, orderId);
    if (!order) throw new NotFoundError('Order not found');

    if (opts.customerUserId) {
      if (order.user_id !== opts.customerUserId) throw new NotFoundError('Order not found');
      if (!CUSTOMER_CANCELLABLE.includes(order.status)) {
        throw new ConflictError('This order can no longer be cancelled. Please contact support.');
      }
    }
    if (order.status === newStatus) throw new BadRequestError(`Order is already ${newStatus}`);
    if (!(ORDER_TRANSITIONS[order.status] ?? []).includes(newStatus)) {
      throw new ConflictError(`An order that is "${order.status}" cannot be changed to "${newStatus}"`);
    }

    const updated = await ordersRepository.setStatus(client, orderId, newStatus);

    // Cancelled / returned goods go back on the shelf (once: both states are one-way).
    if (newStatus === 'cancelled' || newStatus === 'returned') {
      const reason = newStatus === 'cancelled' ? 'order_cancelled' : 'order_returned';
      const touched = new Set<string>();
      for (const item of await ordersRepository.itemsForRestock(client, orderId)) {
        const row = await ordersRepository.restockVariant(client, item.variant_id, item.quantity);
        if (!row) continue; // variant was deleted meanwhile
        await ordersRepository.addMovement(client, {
          productId: item.product_id,
          variantId: item.variant_id,
          previous: row.stock_quantity - item.quantity,
          next: row.stock_quantity,
          reason,
          note: `Order ${order.order_number}`,
          adminId: opts.customerUserId ? null : opts.changedBy,
        });
        touched.add(item.product_id);
      }
      for (const productId of touched) await syncProductStockStatus(client, productId);
    }
    if (newStatus === 'cancelled' && order.coupon_id) {
      await couponsService.releaseWithinTransaction(client, order.coupon_id);
    }

    // Keep payment state consistent with the order lifecycle.
    if (newStatus === 'delivered' && order.payment_status === 'unpaid' && order.payment_provider === 'cod') {
      await ordersRepository.setPaymentStatus(client, orderId, 'paid');
      await ordersRepository.setLatestPaymentRow(client, orderId, 'paid');
    }
    if (newStatus === 'refunded' && ['paid', 'partially_refunded'].includes(order.payment_status)) {
      await ordersRepository.setPaymentStatus(client, orderId, 'refunded');
      await ordersRepository.setLatestPaymentRow(client, orderId, 'refunded');
    }

    await ordersRepository.addStatusHistory(
      client, orderId, newStatus, opts.changedBy,
      opts.note ?? (opts.customerUserId ? 'Cancelled by customer' : undefined)
    );
    return { before: order, after: updated };
  });
}

export const ordersService = {
  async listMyOrders(userId: string, query: { page?: string; limit?: string }) {
    const { page, limit, offset } = parsePagination(query);
    const { rows, total } = await ordersRepository.listForUser(userId, limit, offset);
    return { orders: rows.map(toCustomerOrder), meta: buildPaginationMeta(page, limit, total) };
  },

  async getMyOrder(userId: string, orderNumber: string) {
    const order = await ordersRepository.findByOrderNumberForUser(userId, orderNumber);
    if (!order) throw new NotFoundError('Order not found');
    return toCustomerOrder(order);
  },

  async cancelMyOrder(userId: string, orderNumber: string) {
    const orderId = await ordersRepository.idByOrderNumberForUser(userId, orderNumber);
    if (!orderId) throw new NotFoundError('Order not found');
    await changeStatus(orderId, 'cancelled', { changedBy: userId, customerUserId: userId });
    return this.getMyOrder(userId, orderNumber);
  },

  async adminList(query: { page?: string; limit?: string; status?: string; paymentStatus?: string; search?: string }) {
    const { page, limit, offset } = parsePagination(query);
    const { rows, total } = await ordersRepository.adminList({
      limit, offset, status: query.status, paymentStatus: query.paymentStatus, search: query.search,
    });
    return { orders: rows.map(toAdminOrder), meta: buildPaginationMeta(page, limit, total) };
  },

  async adminGetById(id: string) {
    const order = await ordersRepository.adminFindById(id);
    if (!order) throw new NotFoundError('Order not found');
    return toAdminOrder(order);
  },

  async adminUpdateStatus(id: string, status: string, adminId: string, note?: string) {
    const { before, after } = await changeStatus(id, status, { changedBy: adminId, note });
    return { before: toAdminOrder(before), after: toAdminOrder(after) };
  },

  async adminUpdatePaymentStatus(id: string, paymentStatus: string, transactionId?: string) {
    return withTransaction(async (client) => {
      const order = await ordersRepository.lockOrder(client, id);
      if (!order) throw new NotFoundError('Order not found');
      if (order.payment_status === paymentStatus) throw new BadRequestError(`Payment is already marked ${paymentStatus}`);
      if (['refunded', 'partially_refunded'].includes(paymentStatus) && !['paid', 'partially_refunded'].includes(order.payment_status)) {
        throw new ConflictError('Only a paid order can be refunded');
      }
      if (paymentStatus === 'paid' && ['cancelled', 'refunded'].includes(order.status)) {
        throw new ConflictError(`A ${order.status} order cannot be marked as paid`);
      }
      await ordersRepository.setPaymentStatus(client, id, paymentStatus);
      const rowStatus = paymentStatus === 'unpaid' ? 'pending' : paymentStatus;
      await ordersRepository.setLatestPaymentRow(client, id, rowStatus, transactionId);
      return { before: { payment_status: order.payment_status }, after: { payment_status: paymentStatus, transactionId } };
    });
  },

  async adminUpdateNote(id: string, note: string) {
    const order = await ordersRepository.updateAdminNote(id, note.trim() === '' ? null : note.trim());
    if (!order) throw new NotFoundError('Order not found');
    return toAdminOrder(order);
  },
};
