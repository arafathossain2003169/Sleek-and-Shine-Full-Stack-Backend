import { NextFunction, Request, Response } from 'express';
import { query } from '../config/db';
import { UnauthorizedError } from '../utils/errors';
import { UserRole, verifyAccessToken } from '../utils/tokens';

function extractToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) {
    return header.slice('Bearer '.length).trim();
  }
  return req.cookies?.access_token ?? null;
}

interface LiveUser {
  id: string;
  email: string;
  role: UserRole;
  status: string;
}

/** Resolves the token to the *current* DB state, so blocks and role changes apply immediately. */
async function resolveUser(token: string): Promise<LiveUser> {
  const payload = verifyAccessToken(token);
  const result = await query<LiveUser>(
    'SELECT id, email, role, status FROM users WHERE id = $1',
    [payload.sub]
  );
  const user = result.rows[0];
  if (!user) throw new UnauthorizedError('Account no longer exists');
  if (user.status !== 'active') throw new UnauthorizedError('This account is not active');
  return user;
}

/** Requires a valid access token (Authorization header or cookie). Populates req.user. */
export async function requireAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const token = extractToken(req);
    if (!token) throw new UnauthorizedError('Authentication required');
    let user: LiveUser;
    try {
      user = await resolveUser(token);
    } catch (err) {
      if (err instanceof UnauthorizedError) throw err;
      if ((err as { name?: string })?.name === 'JsonWebTokenError' || (err as { name?: string })?.name === 'TokenExpiredError') {
        throw new UnauthorizedError('Invalid or expired access token');
      }
      throw err; // genuine DB failure -> 500, not a bogus 401
    }
    req.user = { id: user.id, role: user.role, email: user.email };
    next();
  } catch (err) {
    next(err);
  }
}

/** Attaches req.user if a valid token is present, but never rejects. */
export async function attachUserIfPresent(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const token = extractToken(req);
    if (token) {
      const user = await resolveUser(token);
      req.user = { id: user.id, role: user.role, email: user.email };
    }
  } catch {
    /* optional auth: ignore */
  }
  next();
}
