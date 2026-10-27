import { z } from 'zod';
import { digitsString } from '../../utils/validators';

export const orderNumberParamSchema = z.object({
  orderNumber: z.string().trim().min(5).max(30).regex(/^[A-Za-z0-9-]+$/),
});

export const listQuerySchema = z.object({
  page: digitsString.optional(),
  limit: digitsString.optional(),
});

export const ORDER_STATUSES = [
  'pending', 'confirmed', 'processing', 'packed', 'shipped',
  'delivered', 'cancelled', 'returned', 'refunded', 'failed_payment',
] as const;
export const PAYMENT_STATUSES = ['unpaid', 'paid', 'failed', 'refunded', 'partially_refunded'] as const;
