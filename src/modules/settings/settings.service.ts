import { query, withTransaction } from '../../config/db';
import { env } from '../../config/env';
import { BadRequestError } from '../../utils/errors';

export interface AppSettings {
  deliveryFee: number;
  freeDeliveryThreshold: number;
  lowStockThreshold: number;
  otpTtlMinutes: number;
  otpMaxAttempts: number;
  otpResendCooldownSeconds: number;
  otpMaxSendsPerHour: number;
}

export interface SettingDefinition {
  key: string;
  prop: keyof AppSettings;
  group: 'Shipping' | 'Inventory' | 'Security';
  label: string;
  description: string;
  kind: 'money' | 'integer';
  min: number;
  max: number;
  step: number;
  /** value used when the admin has not overridden it (comes from the environment) */
  defaultValue: () => number;
}

/** Everything an admin may tune from the panel. Anything not listed here stays environment-only. */
export const SETTING_DEFINITIONS: SettingDefinition[] = [
  {
    key: 'shipping.deliveryFee', prop: 'deliveryFee', group: 'Shipping', label: 'Delivery fee',
    description: 'Flat delivery charge added to an order. 0 means delivery is always free.',
    kind: 'money', min: 0, max: 100000, step: 0.01, defaultValue: () => env.DELIVERY_FEE,
  },
  {
    key: 'shipping.freeDeliveryThreshold', prop: 'freeDeliveryThreshold', group: 'Shipping', label: 'Free delivery above',
    description: 'Orders with a subtotal above this amount ship free. 0 disables the free-delivery offer.',
    kind: 'money', min: 0, max: 10000000, step: 0.01, defaultValue: () => env.FREE_DELIVERY_THRESHOLD,
  },
  {
    key: 'inventory.lowStockThreshold', prop: 'lowStockThreshold', group: 'Inventory', label: 'Low-stock threshold',
    description: 'A variant at or below this many units is flagged "low stock" in the dashboard and inventory.',
    kind: 'integer', min: 0, max: 100000, step: 1, defaultValue: () => env.LOW_STOCK_THRESHOLD,
  },
  {
    key: 'otp.ttlMinutes', prop: 'otpTtlMinutes', group: 'Security', label: 'Code validity (minutes)',
    description: 'How long an emailed verification code stays valid.',
    kind: 'integer', min: 1, max: 60, step: 1, defaultValue: () => env.OTP_TTL_MINUTES,
  },
  {
    key: 'otp.maxAttempts', prop: 'otpMaxAttempts', group: 'Security', label: 'Wrong-code attempts',
    description: 'Wrong guesses allowed before a code is invalidated.',
    kind: 'integer', min: 1, max: 10, step: 1, defaultValue: () => env.OTP_MAX_ATTEMPTS,
  },
  {
    key: 'otp.resendCooldownSeconds', prop: 'otpResendCooldownSeconds', group: 'Security', label: 'Resend cooldown (seconds)',
    description: 'Minimum wait before another code can be requested.',
    kind: 'integer', min: 0, max: 600, step: 1, defaultValue: () => env.OTP_RESEND_COOLDOWN_SECONDS,
  },
  {
    key: 'otp.maxSendsPerHour', prop: 'otpMaxSendsPerHour', group: 'Security', label: 'Codes per hour (per email)',
    description: 'Maximum verification emails sent to one address per hour.',
    kind: 'integer', min: 1, max: 50, step: 1, defaultValue: () => env.OTP_MAX_SENDS_PER_HOUR,
  },
];

const BY_KEY = new Map(SETTING_DEFINITIONS.map((d) => [d.key, d]));

// Short cache: most requests need these values, and other API instances pick up a change within the TTL.
const CACHE_TTL_MS = 10_000;
let cache: { at: number; overrides: Map<string, number> } | null = null;

async function loadOverrides(): Promise<Map<string, number>> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.overrides;
  const rows = await query<{ key: string; value: unknown }>('SELECT key, value FROM app_settings');
  const overrides = new Map<string, number>();
  for (const row of rows.rows) {
    const def = BY_KEY.get(row.key);
    const n = Number(row.value);
    if (def && Number.isFinite(n)) overrides.set(row.key, n);
  }
  cache = { at: Date.now(), overrides };
  return overrides;
}

export function invalidateSettingsCache(): void {
  cache = null;
}

/** Effective values (admin override, else environment default). */
export async function getSettings(): Promise<AppSettings> {
  const overrides = await loadOverrides();
  const out = {} as Record<keyof AppSettings, number>;
  for (const def of SETTING_DEFINITIONS) out[def.prop] = overrides.get(def.key) ?? def.defaultValue();
  return out as AppSettings;
}

function validateValue(def: SettingDefinition, value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('must be a number');
  if (value < def.min || value > def.max) throw new Error(`must be between ${def.min} and ${def.max}`);
  if (def.kind === 'integer' && !Number.isInteger(value)) throw new Error('must be a whole number');
  if (def.kind === 'money' && Math.abs(value * 100 - Math.round(value * 100)) > 1e-6) throw new Error('can have at most 2 decimals');
  return value;
}

export const settingsService = {
  async listForAdmin() {
    const rows = await query<{ key: string; value: unknown; updated_at: string }>('SELECT key, value, updated_at FROM app_settings');
    const stored = new Map(rows.rows.map((r) => [r.key, r]));
    return SETTING_DEFINITIONS.map((d) => {
      const row = stored.get(d.key);
      const override = row ? Number(row.value) : null;
      return {
        key: d.key, group: d.group, label: d.label, description: d.description,
        kind: d.kind, min: d.min, max: d.max, step: d.step,
        value: override ?? d.defaultValue(),
        defaultValue: d.defaultValue(),
        isCustom: override !== null,
        updatedAt: row?.updated_at ?? null,
      };
    });
  },

  /**
   * `values[key] = number` sets an override, `null` removes it (back to the environment default).
   * All-or-nothing: one invalid field rejects the whole request.
   */
  async update(values: Record<string, number | null>, adminId: string) {
    const problems: { path: string; message: string }[] = [];
    const sets: [string, number][] = [];
    const resets: string[] = [];

    for (const [key, raw] of Object.entries(values)) {
      const def = BY_KEY.get(key);
      if (!def) { problems.push({ path: key, message: 'Unknown setting' }); continue; }
      if (raw === null) { resets.push(key); continue; }
      try { sets.push([key, validateValue(def, raw)]); } catch (e) { problems.push({ path: key, message: `${def.label} ${(e as Error).message}` }); }
    }
    if (problems.length) throw new BadRequestError('Invalid settings', problems);

    const before = await getSettings();
    await withTransaction(async (client) => {
      for (const [key, value] of sets) {
        await client.query(
          `INSERT INTO app_settings (key, value, updated_by, updated_at) VALUES ($1, $2::jsonb, $3, now())
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
          [key, JSON.stringify(value), adminId]
        );
      }
      if (resets.length) await client.query('DELETE FROM app_settings WHERE key = ANY($1::varchar[])', [resets]);
    });
    invalidateSettingsCache();
    return { before, after: await getSettings() };
  },
};
