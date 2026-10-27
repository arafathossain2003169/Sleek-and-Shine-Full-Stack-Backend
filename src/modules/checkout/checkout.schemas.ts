import { z } from 'zod';
import { env } from '../../config/env';

const providers = env.PAYMENT_PROVIDERS.length ? env.PAYMENT_PROVIDERS : ['cod'];

const blankToUndefined = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);

// NOTE: there is intentionally no deliveryFee here. Shipping is computed on the server.
export const checkoutSchema = z.object({
  addressId: z.string().uuid('A valid delivery address is required'),
  couponCode: z.preprocess(blankToUndefined, z.string().trim().max(50).optional()),
  paymentProvider: z
    .string()
    .refine((v) => providers.includes(v), `Payment method not available. Use one of: ${providers.join(', ')}`)
    .default(providers[0]),
  customerNote: z.preprocess(blankToUndefined, z.string().trim().max(1000).optional()),
});

export const quoteSchema = z.object({
  couponCode: z.preprocess(blankToUndefined, z.string().trim().max(50).optional()),
});
