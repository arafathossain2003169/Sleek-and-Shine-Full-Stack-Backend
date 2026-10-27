import { z } from 'zod';
import { decimalString, digitsString, emptyToUndefined, httpUrl, money, optionalSlug } from '../../utils/validators';

const boolFromQuery = z
  .union([z.literal('true'), z.literal('false')])
  .optional()
  .transform((v) => (v === undefined ? undefined : v === 'true'));

export const SORT_VALUES = ['newest', 'price_asc', 'price_desc', 'name_asc', 'best_selling', 'discount'] as const;

export const listProductsQuerySchema = z
  .object({
    page: digitsString.optional(),
    limit: digitsString.optional(),
    search: z.preprocess(emptyToUndefined, z.string().trim().min(2, 'Search must be at least 2 characters').max(100).optional()),
    category: z.string().trim().max(200).optional(), // category slug (includes sub-categories)
    brand: z.string().trim().max(200).optional(), // brand slug
    minPrice: decimalString.optional(),
    maxPrice: decimalString.optional(),
    sort: z.enum(SORT_VALUES).optional(),
    isNewArrival: boolFromQuery,
    isOffer: boolFromQuery,
    isFeatured: boolFromQuery,
    attributes: z.string().max(2000).optional(), // JSON-encoded object of attribute filters
  })
  .refine(
    (q) => q.minPrice === undefined || q.maxPrice === undefined || Number(q.minPrice) <= Number(q.maxPrice),
    { message: 'minPrice must not be greater than maxPrice', path: ['minPrice'] }
  );

export const adminListProductsQuerySchema = z.object({
  page: digitsString.optional(),
  limit: digitsString.optional(),
  search: z.preprocess(emptyToUndefined, z.string().trim().max(100).optional()),
  category: z.string().trim().max(200).optional(),
  brand: z.string().trim().max(200).optional(),
  status: z.enum(['draft', 'published', 'hidden', 'archived']).optional(),
  sort: z.enum(SORT_VALUES).optional(),
});

export const slugParamSchema = z.object({ slug: z.string().trim().min(1).max(300) });

const productStatusEnum = z.enum(['draft', 'published', 'hidden', 'archived']);
const stockStatusEnum = z.enum(['in_stock', 'low_stock', 'out_of_stock', 'discontinued']);

/** "" or whitespace becomes null so a blank form field clears the value. */
const nullableText = (max: number) =>
  z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
    z.string().trim().max(max).nullable().optional()
  );

const productBase = z.object({
  name: z.string().trim().min(2).max(255),
  slug: optionalSlug(280),
  shortDescription: nullableText(1000),
  fullDescription: nullableText(20000),
  brandId: z.string().uuid().nullable().optional(),
  categoryId: z.string().uuid(),
  basePrice: money,
  salePrice: money.nullable().optional(),
  sku: nullableText(100),
  barcode: nullableText(100),
  stockStatus: stockStatusEnum.optional(),
  status: productStatusEnum.optional(),
  isFeatured: z.boolean().optional(),
  isNewArrival: z.boolean().optional(),
  isOffer: z.boolean().optional(),
  attributes: z.record(z.string(), z.unknown()).optional(),
  seoTitle: nullableText(255),
  seoDescription: nullableText(500),
});

type SaleCheck = { basePrice?: number; salePrice?: number | null };
const saleCheck = (v: SaleCheck, ctx: z.RefinementCtx) => {
  if (v.salePrice !== null && v.salePrice !== undefined && v.basePrice !== undefined && v.salePrice >= v.basePrice) {
    ctx.addIssue({ code: 'custom', path: ['salePrice'], message: 'Sale price must be lower than the regular price' });
  }
};

export const createProductSchema = productBase.superRefine(saleCheck);
export const updateProductSchema = productBase.partial().superRefine(saleCheck);

export const updateProductStatusSchema = z.object({ status: productStatusEnum });

export const productIdParamSchema = z.object({ id: z.string().uuid('Invalid product id') });

const variantBase = z.object({
  name: z.string().trim().min(1).max(150),
  sku: nullableText(100),
  barcode: nullableText(100),
  price: money.nullable().optional(),
  salePrice: money.nullable().optional(),
  attributes: z.record(z.string(), z.unknown()).optional(),
  imageUrl: httpUrl.nullable().optional(),
  status: z.enum(['active', 'inactive']).optional(),
});

const variantSaleCheck = (v: { price?: number | null; salePrice?: number | null }, ctx: z.RefinementCtx) => {
  if (v.salePrice != null && v.price != null && v.salePrice >= v.price) {
    ctx.addIssue({ code: 'custom', path: ['salePrice'], message: 'Sale price must be lower than the price' });
  }
};

// Stock is only ever changed through the inventory module (audited, movement-logged, locked).
export const createVariantSchema = variantBase
  .extend({ stockQuantity: z.number().int().min(0).max(1_000_000).default(0) })
  .superRefine(variantSaleCheck);
export const updateVariantSchema = variantBase.partial().superRefine(variantSaleCheck);

export const variantIdParamSchema = z.object({ id: z.string().uuid(), variantId: z.string().uuid() });
export const imageIdParamSchema = z.object({ id: z.string().uuid(), imageId: z.string().uuid() });

export const updateImageSchema = z.object({
  altText: z.string().trim().max(255).nullable().optional(),
  sortOrder: z.number().int().min(0).max(10000).optional(),
  isMain: z.boolean().optional(),
});

export const imageUploadMetaSchema = z.object({
  altText: z.preprocess(emptyToUndefined, z.string().trim().max(255).optional()),
  sortOrder: z.preprocess(emptyToUndefined, z.coerce.number().int().min(0).max(10000).optional()),
  isMain: z.preprocess((v) => v === 'true' || v === true, z.boolean()),
  variantId: z.preprocess(emptyToUndefined, z.string().uuid().optional()),
});
