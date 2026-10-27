import { z } from 'zod';
import { env } from '../../config/env';

const quantity = z.number().int().min(1).max(env.MAX_CART_QUANTITY);

export const addCartItemSchema = z.object({
  productId: z.string().uuid(),
  variantId: z.string().uuid().nullable().optional(),
  quantity: quantity.default(1),
});

export const updateCartItemSchema = z.object({ quantity });

export const cartItemIdParamSchema = z.object({ itemId: z.string().uuid() });

export const syncCartSchema = z.object({
  items: z
    .array(
      z.object({
        productId: z.string().uuid(),
        variantId: z.string().uuid().nullable().optional(),
        quantity,
      })
    )
    .max(100),
});
