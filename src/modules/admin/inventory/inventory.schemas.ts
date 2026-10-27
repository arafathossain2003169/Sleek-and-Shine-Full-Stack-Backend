import { z } from 'zod';
import { digitsString, emptyToUndefined } from '../../../utils/validators';

export const adjustInventorySchema = z.object({
  productId: z.string().uuid(),
  variantId: z.string().uuid(),
  newQuantity: z.number().int().min(0).max(1_000_000),
  reason: z.string().trim().min(1).max(100),
  note: z.preprocess(emptyToUndefined, z.string().trim().max(500).optional()),
});

export const listQuerySchema = z.object({
  page: digitsString.optional(),
  limit: digitsString.optional(),
  search: z.preprocess(emptyToUndefined, z.string().trim().max(100).optional()),
  lowStock: z.enum(['true', 'false']).optional(),
});

export const movementsQuerySchema = z.object({
  page: digitsString.optional(),
  limit: digitsString.optional(),
  productId: z.string().uuid().optional(),
});
