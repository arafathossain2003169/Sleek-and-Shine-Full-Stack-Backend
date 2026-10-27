import { z } from 'zod';
import { isoDateTime, money } from '../../utils/validators';

export const validateCouponSchema = z.object({
  code: z.string().trim().min(1).max(50),
  orderAmount: z.number().finite().nonnegative().max(9_999_999).optional(),
});

export const idParamSchema = z.object({ id: z.string().uuid() });

const blankToNull = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : v);
const nullableDate = z.preprocess(blankToNull, isoDateTime.nullable().optional());

const couponBase = z.object({
  code: z
    .string()
    .trim()
    .min(2)
    .max(50)
    .regex(/^[A-Za-z0-9_-]+$/, 'Use letters, numbers, - or _ only')
    .transform((v) => v.toUpperCase()),
  type: z.enum(['percentage', 'fixed']),
  value: money.refine((v) => v > 0, 'Value must be greater than 0'),
  minOrderAmount: money.nullable().optional(),
  maxDiscount: money.nullable().optional(),
  startsAt: nullableDate,
  endsAt: nullableDate,
  usageLimit: z.number().int().positive().max(10_000_000).nullable().optional(),
  perUserLimit: z.number().int().positive().max(1000).nullable().optional(),
  isActive: z.boolean().optional().default(true),
});

type Check = {
  type?: string;
  value?: number;
  startsAt?: string | null;
  endsAt?: string | null;
};
const rules = (v: Check, ctx: z.RefinementCtx) => {
  if (v.type === 'percentage' && v.value !== undefined && v.value > 100) {
    ctx.addIssue({ code: 'custom', path: ['value'], message: 'A percentage coupon cannot exceed 100' });
  }
  if (v.startsAt && v.endsAt && Date.parse(v.endsAt) <= Date.parse(v.startsAt)) {
    ctx.addIssue({ code: 'custom', path: ['endsAt'], message: 'End date must be after the start date' });
  }
};

export const createCouponSchema = couponBase.superRefine(rules);
export const updateCouponSchema = couponBase
  .partial()
  .extend({ isActive: z.boolean().optional() })
  .superRefine(rules);
