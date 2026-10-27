import crypto from 'crypto';
import jwt, { SignOptions } from 'jsonwebtoken';
import { env } from '../config/env';

export type UserRole =
  | 'customer'
  | 'admin'
  | 'manager'
  | 'inventory_staff'
  | 'order_manager'
  | 'super_admin';

export interface AccessTokenPayload {
  sub: string; // user id
  role: UserRole;
  email: string;
}

export interface RefreshTokenPayload {
  sub: string; // user id
  tokenId: string; // refresh_tokens.id, used to look up/revoke
}

export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    expiresIn: env.JWT_ACCESS_EXPIRES_IN,
    algorithm: 'HS256',
  } as SignOptions);
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, env.JWT_ACCESS_SECRET, { algorithms: ['HS256'] }) as AccessTokenPayload;
}

export function signRefreshToken(payload: RefreshTokenPayload): string {
  return jwt.sign(payload, env.JWT_REFRESH_SECRET, {
    expiresIn: env.JWT_REFRESH_EXPIRES_IN,
    algorithm: 'HS256',
  } as SignOptions);
}

export function verifyRefreshToken(token: string): RefreshTokenPayload {
  return jwt.verify(token, env.JWT_REFRESH_SECRET, { algorithms: ['HS256'] }) as RefreshTokenPayload;
}

/**
 * Refresh tokens are stored hashed (never plaintext) in the DB,
 * mirroring how passwords are handled.
 */
export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function generateOpaqueId(): string {
  return crypto.randomUUID();
}

export function refreshExpiryDate(): Date {
  return new Date(Date.now() + env.JWT_REFRESH_EXPIRES_IN_MS);
}
