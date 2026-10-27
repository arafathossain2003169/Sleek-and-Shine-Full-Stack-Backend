import { z } from 'zod';
import { digitsString, emptyToUndefined } from '../../../utils/validators';
import { ORDER_STATUSES, PAYMENT_STATUSES } from '../../orders/orders.schemas';

export const idParamSchema = z.object({ id: z.string().uuid() });

export const updateOrderStatusSchema = z.object({
  status: z.enum(ORDER_STATUSES),
  note: z.preprocess(emptyToUndefined, z.string().trim().max(1000).optional()),
});

export const updatePaymentStatusSchema = z.object({
  paymentStatus: z.enum(PAYMENT_STATUSES),
  transactionId: z.preprocess(emptyToUndefined, z.string().trim().max(150).optional()),
});

// Empty string clears the note.
export const updateAdminNoteSchema = z.object({ note: z.string().trim().max(2000) });

export const listOrdersQuerySchema = z.object({
  page: digitsString.optional(),
  limit: digitsString.optional(),
  status: z.enum(ORDER_STATUSES).optional(),
  paymentStatus: z.enum(PAYMENT_STATUSES).optional(),
  search: z.preprocess(emptyToUndefined, z.string().trim().max(100).optional()),
});
