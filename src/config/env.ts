import dotenv from 'dotenv';
import path from 'path';
import { parseDurationMs } from '../utils/duration';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`Environment variable ${name} must be a number`);
  return n;
}

const NODE_ENV = process.env.NODE_ENV ?? 'development';
const IS_PROD = NODE_ENV === 'production';

const JWT_ACCESS_SECRET = required('JWT_ACCESS_SECRET');
const JWT_REFRESH_SECRET = required('JWT_REFRESH_SECRET');
const COOKIE_SECRET = required('COOKIE_SECRET');

if (IS_PROD) {
  for (const [name, value] of Object.entries({ JWT_ACCESS_SECRET, JWT_REFRESH_SECRET, COOKIE_SECRET })) {
    if (value.length < 32 || /change_this/i.test(value)) {
      throw new Error(`${name} must be a strong random value of at least 32 characters in production`);
    }
  }
  if (JWT_ACCESS_SECRET === JWT_REFRESH_SECRET) {
    throw new Error('JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must differ');
  }
}

if (IS_PROD && process.env.OTP_REQUIRED !== 'false' && !process.env.SMTP_HOST) {
  throw new Error('OTP verification is enabled but SMTP_HOST is not set. Configure SMTP_* (or set OTP_REQUIRED=false).');
}

const JWT_ACCESS_EXPIRES_IN = process.env.JWT_ACCESS_EXPIRES_IN ?? '15m';
const JWT_REFRESH_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES_IN ?? '30d';

export const env = {
  PORT: num('PORT', 5000),
  NODE_ENV,
  IS_PROD,
  IS_DEV: NODE_ENV === 'development',
  IS_TEST: NODE_ENV === 'test',

  DATABASE_URL: required('DATABASE_URL'),
  DB_SSL: process.env.DB_SSL ? process.env.DB_SSL === 'true' : IS_PROD,
  // Set DB_SSL_REJECT_UNAUTHORIZED=false only for providers with self-signed certs.
  DB_SSL_REJECT_UNAUTHORIZED: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false',

  FRONTEND_URL: required('FRONTEND_URL', 'http://localhost:3000'),
  TRUST_PROXY: num('TRUST_PROXY', 1),

  JWT_ACCESS_SECRET,
  JWT_REFRESH_SECRET,
  JWT_ACCESS_EXPIRES_IN,
  JWT_REFRESH_EXPIRES_IN,
  JWT_ACCESS_EXPIRES_IN_MS: parseDurationMs(JWT_ACCESS_EXPIRES_IN, 15 * 60 * 1000),
  JWT_REFRESH_EXPIRES_IN_MS: parseDurationMs(JWT_REFRESH_EXPIRES_IN, 30 * 24 * 60 * 60 * 1000),

  COOKIE_SECRET,

  CLOUDINARY_CLOUD_NAME: process.env.CLOUDINARY_CLOUD_NAME ?? '',
  CLOUDINARY_API_KEY: process.env.CLOUDINARY_API_KEY ?? '',
  CLOUDINARY_API_SECRET: process.env.CLOUDINARY_API_SECRET ?? '',

  DEFAULT_CURRENCY: process.env.DEFAULT_CURRENCY ?? 'USD',

  // One-time passcodes (e-mail) required for sign-up and every login.
  OTP_REQUIRED: process.env.OTP_REQUIRED !== 'false',
  OTP_TTL_MINUTES: num('OTP_TTL_MINUTES', 10),
  OTP_MAX_ATTEMPTS: num('OTP_MAX_ATTEMPTS', 5),
  OTP_RESEND_COOLDOWN_SECONDS: num('OTP_RESEND_COOLDOWN_SECONDS', 30),
  OTP_MAX_SENDS_PER_HOUR: num('OTP_MAX_SENDS_PER_HOUR', 5),

  // E-mail delivery. Without SMTP_HOST, development/test print codes to the console instead.
  SMTP_HOST: process.env.SMTP_HOST ?? '',
  SMTP_PORT: num('SMTP_PORT', 587),
  SMTP_USER: process.env.SMTP_USER ?? '',
  SMTP_PASS: process.env.SMTP_PASS ?? '',
  SMTP_SECURE: process.env.SMTP_SECURE === 'true',
  MAIL_FROM: process.env.MAIL_FROM ?? 'SleeknShine <no-reply@localhost>',

  // Shipping is computed on the server. Orders with subtotal > threshold ship free.
  DELIVERY_FEE: num('DELIVERY_FEE', 5),
  FREE_DELIVERY_THRESHOLD: num('FREE_DELIVERY_THRESHOLD', 50),
  LOW_STOCK_THRESHOLD: num('LOW_STOCK_THRESHOLD', 10),
  MAX_CART_QUANTITY: 99,

  // Only enable providers that are actually wired up. COD needs no gateway.
  PAYMENT_PROVIDERS: (process.env.ENABLED_PAYMENT_PROVIDERS ?? 'cod')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
};
