import { z } from 'zod';
import { digitsString, httpUrl, optionalSlug } from '../../utils/validators';
import { listProductsQuerySchema as productListQuerySchema } from '../products/products.schemas';

export const slugParamSchema = z.object({ slug: z.string().trim().min(1).max(200) });
export const idParamSchema = z.object({ id: z.string().uuid() });

// Category/brand product pages accept the same filters/sorting as /products.
export const listProductsQuerySchema = productListQuerySchema;
export const simplePageQuerySchema = z.object({ page: digitsString.optional(), limit: digitsString.optional() });

const blankToNull = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : v);

export const createCategorySchema = z.object({
  name: z.string().trim().min(1).max(150),
  slug: optionalSlug(180),
  parentId: z.string().uuid().nullable().optional(),
  description: z.preprocess(blankToNull, z.string().trim().max(2000).nullable().optional()),
  imageUrl: z.preprocess(blankToNull, httpUrl.nullable().optional()),
  sortOrder: z.number().int().min(0).max(100000).optional().default(0),
  isActive: z.boolean().optional().default(true),
});

export const updateCategorySchema = createCategorySchema.partial();
