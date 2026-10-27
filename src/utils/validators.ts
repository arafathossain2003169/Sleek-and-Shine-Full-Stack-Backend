import { z } from 'zod';
import { slugify } from './slug';

/** Treat "" (blank form fields) as "not provided". */
export const emptyToUndefined = (v: unknown) =>
  typeof v === 'string' && v.trim() === '' ? undefined : v;

/** URL that is either an absolute http(s) URL or a same-site path ("/shop"). */
export const safeUrl = z
  .string()
  .trim()
  .max(500)
  .refine(
    (v) => (v.startsWith('/') && !v.startsWith('//')) || /^https?:\/\/[^\s]+$/i.test(v),
    'Must be an http(s) URL or a path starting with "/"'
  );

export const httpUrl = z
  .string()
  .trim()
  .max(500)
  .refine((v) => /^https?:\/\/[^\s]+$/i.test(v), 'Must be an http(s) URL');

/** Optional slug: blank -> undefined, otherwise normalised to a URL-safe slug. */
export const optionalSlug = (max: number) =>
  z.preprocess(
    emptyToUndefined,
    z
      .string()
      .trim()
      .max(max)
      .transform((v) => slugify(v))
      .refine((v) => v.length >= 2, 'Slug must contain at least 2 letters or digits')
      .optional()
  );

export const money = z
  .number()
  .finite()
  .nonnegative()
  .max(9_999_999.99)
  .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, 'Max 2 decimal places');

export const digitsString = z.string().regex(/^\d{1,9}$/, 'Must be a positive integer');
export const decimalString = z.string().regex(/^\d{1,9}(\.\d{1,2})?$/, 'Must be a number');

export const isoDateTime = z.string().datetime({ offset: true });
