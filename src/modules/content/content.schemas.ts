import { z } from 'zod';
import { httpUrl, isoDateTime, safeUrl } from '../../utils/validators';

export const idParamSchema = z.object({ id: z.string().uuid() });

const blankToNull = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : v);

const sectionBase = z.object({
  type: z.enum(['hero', 'banner', 'offer', 'new_arrival', 'featured_category', 'custom']),
  title: z.string().trim().min(1).max(255),
  subtitle: z.preprocess(blankToNull, z.string().trim().max(500).nullable().optional()),
  imageUrl: z.preprocess(blankToNull, httpUrl.nullable().optional()),
  buttonText: z.preprocess(blankToNull, z.string().trim().max(100).nullable().optional()),
  buttonLink: z.preprocess(blankToNull, safeUrl.nullable().optional()), // blocks javascript: etc.
  data: z.record(z.string(), z.unknown()).optional().default({}),
  sortOrder: z.number().int().min(0).max(100000).optional().default(0),
  isActive: z.boolean().optional().default(true),
  startsAt: z.preprocess(blankToNull, isoDateTime.nullable().optional()),
  endsAt: z.preprocess(blankToNull, isoDateTime.nullable().optional()),
});

const dateOrder = (v: { startsAt?: string | null; endsAt?: string | null }, ctx: z.RefinementCtx) => {
  if (v.startsAt && v.endsAt && Date.parse(v.endsAt) <= Date.parse(v.startsAt)) {
    ctx.addIssue({ code: 'custom', path: ['endsAt'], message: 'End date must be after the start date' });
  }
};

export const createSectionSchema = sectionBase.superRefine(dateOrder);
// Partial without defaults: omitted keys stay untouched, null clears.
export const updateSectionSchema = sectionBase
  .partial()
  .extend({
    data: z.record(z.string(), z.unknown()).optional(),
    sortOrder: z.number().int().min(0).max(100000).optional(),
    isActive: z.boolean().optional(),
  })
  .superRefine(dateOrder);
