import { PoolClient } from 'pg';
import { BadRequestError, ConflictError, NotFoundError } from '../../utils/errors';
import { round2 } from '../../utils/pricing';
import { couponsRepository } from './coupons.repository';

export interface CouponRow {
  id: string;
  code: string;
  type: 'percentage' | 'fixed';
  value: string;
  min_order_amount: string | null;
  max_discount: string | null;
  starts_at: Date | null;
  ends_at: Date | null;
  usage_limit: number | null;
  per_user_limit: number | null;
  used_count: number;
  is_active: boolean;
}

export function assertCouponUsable(coupon: CouponRow, orderAmount: number, userUsage = 0): void {
  if (!coupon.is_active) throw new BadRequestError('This coupon is not currently active');
  const now = new Date();
  if (coupon.starts_at && new Date(coupon.starts_at) > now) throw new BadRequestError('This coupon is not yet valid');
  if (coupon.ends_at && new Date(coupon.ends_at) < now) throw new BadRequestError('This coupon has expired');
  if (coupon.usage_limit !== null && coupon.used_count >= coupon.usage_limit) {
    throw new BadRequestError('This coupon has reached its usage limit');
  }
  if (coupon.per_user_limit !== null && userUsage >= coupon.per_user_limit) {
    throw new BadRequestError('You have already used this coupon the maximum number of times');
  }
  if (coupon.min_order_amount !== null && orderAmount < Number(coupon.min_order_amount)) {
    throw new BadRequestError(`A minimum order amount of ${coupon.min_order_amount} is required for this coupon`);
  }
}

export function computeDiscount(coupon: CouponRow, orderAmount: number): number {
  const value = coupon.type === 'percentage' ? Math.min(Number(coupon.value), 100) : Number(coupon.value);
  let discount = coupon.type === 'percentage' ? (orderAmount * value) / 100 : value;
  if (coupon.max_discount !== null) discount = Math.min(discount, Number(coupon.max_discount));
  return Math.min(round2(discount), orderAmount);
}

export const couponsService = {
  /** Read-only check used for previews. Checkout re-validates inside its transaction. */
  async preview(code: string, orderAmount: number, userId: string) {
    const coupon = (await couponsRepository.findByCode(code)) as CouponRow | null;
    // Same message for unknown codes keeps the endpoint from being a code oracle.
    if (!coupon) throw new NotFoundError('Coupon not found');
    const usage = await couponsRepository.userUsageCount(null, userId, coupon.id);
    assertCouponUsable(coupon, orderAmount, usage);
    return { coupon, discount: computeDiscount(coupon, orderAmount) };
  },

  async validate(code: string, orderAmount: number, userId: string) {
    const { coupon, discount } = await this.preview(code, orderAmount, userId);
    return {
      code: coupon.code,
      type: coupon.type,
      value: Number(coupon.value),
      discount,
      newTotal: round2(orderAmount - discount),
    };
  },

  /** Inside the checkout transaction: lock the coupon, validate, count the use. */
  async applyWithinTransaction(client: PoolClient, code: string, orderAmount: number, userId: string) {
    const coupon = (await couponsRepository.findByCodeForUpdate(client, code)) as CouponRow | null;
    if (!coupon) throw new NotFoundError('Coupon not found');
    const usage = await couponsRepository.userUsageCount(client, userId, coupon.id);
    assertCouponUsable(coupon, orderAmount, usage);
    const discount = computeDiscount(coupon, orderAmount);
    await couponsRepository.incrementUsage(client, coupon.id);
    return { couponId: coupon.id, discount };
  },

  async releaseWithinTransaction(client: PoolClient, couponId: string) {
    await couponsRepository.decrementUsage(client, couponId);
  },

  async adminList() {
    return couponsRepository.listAll();
  },

  async adminCreate(input: Parameters<typeof couponsRepository.create>[0]) {
    if (await couponsRepository.findByCode(input.code)) throw new ConflictError('A coupon with this code already exists');
    return couponsRepository.create(input);
  },

  async adminUpdate(id: string, input: Record<string, unknown>) {
    const existing = await couponsRepository.findById(id);
    if (!existing) throw new NotFoundError('Coupon not found');
    // Cross-field rules must hold against the merged result, not only the patch.
    const type = (input.type ?? existing.type) as string;
    const value = Number(input.value ?? existing.value);
    if (type === 'percentage' && value > 100) throw new BadRequestError('A percentage coupon cannot exceed 100');
    const starts = input.startsAt !== undefined ? (input.startsAt as string | null) : existing.starts_at;
    const ends = input.endsAt !== undefined ? (input.endsAt as string | null) : existing.ends_at;
    if (starts && ends && new Date(ends).getTime() <= new Date(starts).getTime()) {
      throw new BadRequestError('End date must be after the start date');
    }
    if (typeof input.code === 'string' && input.code !== existing.code && (await couponsRepository.findByCode(input.code))) {
      throw new ConflictError('A coupon with this code already exists');
    }
    const after = await couponsRepository.update(id, input);
    return { before: existing, after };
  },

  async adminDelete(id: string) {
    const existing = await couponsRepository.findById(id);
    if (!existing) throw new NotFoundError('Coupon not found');
    await couponsRepository.delete(id);
    return existing;
  },
};
