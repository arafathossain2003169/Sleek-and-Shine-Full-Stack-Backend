import { NextFunction, Request, Response } from 'express';
import { allowedOrigins } from '../config/cors';
import { ForbiddenError } from '../utils/errors';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function originOf(req: Request): string | null {
  const origin = req.headers.origin;
  if (origin) return origin.replace(/\/$/, '');
  const referer = req.headers.referer;
  if (referer) {
    try {
      return new URL(referer).origin;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * CSRF defence for cookie-authenticated requests: when a state-changing request carries
 * auth cookies (and no explicit Authorization header), its Origin must be an allowed frontend.
 * Bearer-token clients are not affected because browsers never attach those automatically.
 */
export function csrfGuard(req: Request, _res: Response, next: NextFunction): void {
  if (SAFE_METHODS.has(req.method)) return next();
  if (req.headers.authorization) return next();

  const hasAuthCookie = !!(req.cookies?.access_token || req.cookies?.refresh_token);
  if (!hasAuthCookie) return next();

  const origin = originOf(req);
  if (!origin || !allowedOrigins.includes(origin)) {
    return next(new ForbiddenError('Cross-site request blocked'));
  }
  next();
}
