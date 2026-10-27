import { PoolClient } from 'pg';
import { query } from '../../config/db';
import { updateRow } from '../../utils/sql';

export const couponsRepository = {
  async findByCode(code: string) {
    const result = await query('SELECT * FROM coupons WHERE code = $1', [code.toUpperCase()]);
    return result.rows[0] ?? null;
  },

  async findByCodeForUpdate(client: PoolClient, code: string) {
    const result = await client.query('SELECT * FROM coupons WHERE code = $1 FOR UPDATE', [code.toUpperCase()]);
    return result.rows[0] ?? null;
  },

  async incrementUsage(client: PoolClient, id: string) {
    await client.query('UPDATE coupons SET used_count = used_count + 1 WHERE id = $1', [id]);
  },

  async decrementUsage(client: PoolClient, id: string) {
    await client.query('UPDATE coupons SET used_count = GREATEST(used_count - 1, 0) WHERE id = $1', [id]);
  },

  /** How many (non-cancelled) orders this user already placed with the coupon. */
  async userUsageCount(runner: Pick<PoolClient, 'query'> | null, userId: string, couponId: string): Promise<number> {
    const text = `SELECT COUNT(*)::text AS c FROM orders
                  WHERE user_id = $1 AND coupon_id = $2 AND status NOT IN ('cancelled', 'failed_payment')`;
    const r = runner ? await runner.query(text, [userId, couponId]) : await query(text, [userId, couponId]);
    return parseInt(r.rows[0].c, 10);
  },

  async listAll() {
    const result = await query('SELECT * FROM coupons ORDER BY created_at DESC, id ASC');
    return result.rows;
  },

  async findById(id: string) {
    const result = await query('SELECT * FROM coupons WHERE id = $1', [id]);
    return result.rows[0] ?? null;
  },

  async create(input: {
    code: string;
    type: string;
    value: number;
    minOrderAmount?: number | null;
    maxDiscount?: number | null;
    startsAt?: string | null;
    endsAt?: string | null;
    usageLimit?: number | null;
    perUserLimit?: number | null;
    isActive: boolean;
  }) {
    const result = await query(
      `INSERT INTO coupons
        (code, type, value, min_order_amount, max_discount, starts_at, ends_at, usage_limit, per_user_limit, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING *`,
      [
        input.code, input.type, input.value, input.minOrderAmount ?? null, input.maxDiscount ?? null,
        input.startsAt ?? null, input.endsAt ?? null, input.usageLimit ?? null,
        input.perUserLimit ?? null, input.isActive,
      ]
    );
    return result.rows[0];
  },

  async update(id: string, input: Record<string, unknown>) {
    return updateRow(
      'coupons',
      id,
      {
        code: 'code',
        type: 'type',
        value: 'value',
        minOrderAmount: 'min_order_amount',
        maxDiscount: 'max_discount',
        startsAt: 'starts_at',
        endsAt: 'ends_at',
        usageLimit: 'usage_limit',
        perUserLimit: 'per_user_limit',
        isActive: 'is_active',
      },
      input
    );
  },

  async delete(id: string) {
    const result = await query('DELETE FROM coupons WHERE id = $1 RETURNING id', [id]);
    return result.rows[0] ?? null;
  },
};
