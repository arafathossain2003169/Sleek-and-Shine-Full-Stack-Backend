import { z } from 'zod';
import { httpUrl, optionalSlug } from '../../utils/validators';
import { listProductsQuerySchema as productListQuerySchema } from '../products/products.schemas';

export const slugParamSchema = z.object({ slug: z.string().trim().min(1).max(200) });
export const idParamSchema = z.object({ id: z.string().uuid() });
export const listQuerySchema = productListQuerySchema;

const blankToNull = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : v);

export const createBrandSchema = z.object({
  name: z.string().trim().min(1).max(150),
  slug: optionalSlug(180),
  description: z.preprocess(blankToNull, z.string().trim().max(2000).nullable().optional()),
  logoUrl: z.preprocess(blankToNull, httpUrl.nullable().optional()),
  isActive: z.boolean().optional().default(true),
});

export const updateBrandSchema = createBrandSchema.partial();
