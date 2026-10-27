import { NextFunction, Request, Response } from 'express';
import { ForbiddenError, UnauthorizedError } from '../utils/errors';
import { UserRole } from '../utils/tokens';

export const ADMIN_ROLES: UserRole[] = ['admin', 'manager', 'inventory_staff', 'order_manager', 'super_admin'];

/** Roles that may change catalogue/marketing data. */
export const CATALOG_WRITE_ROLES: UserRole[] = ['admin', 'manager', 'super_admin'];
export const ORDER_ROLES: UserRole[] = ['admin', 'manager', 'order_manager', 'super_admin'];
export const INVENTORY_WRITE_ROLES: UserRole[] = ['admin', 'manager', 'inventory_staff', 'super_admin'];

/** Restricts a route to one of the given roles. Must run after requireAuth. */
export function requireRole(...roles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) return next(new UnauthorizedError('Authentication required'));
    if (!roles.includes(req.user.role)) {
      return next(new ForbiddenError('You do not have permission to perform this action'));
    }
    next();
  };
}

/** Different role sets for reading (GET/HEAD) and writing (everything else). */
export function requireRoleByMethod(readRoles: UserRole[], writeRoles: UserRole[]) {
  const read = requireRole(...readRoles);
  const write = requireRole(...writeRoles);
  return (req: Request, res: Response, next: NextFunction): void =>
    req.method === 'GET' || req.method === 'HEAD' ? read(req, res, next) : write(req, res, next);
}

/** Roles that may manage staff accounts and store-wide settings. */
export const SETTINGS_ROLES: UserRole[] = ['admin', 'super_admin'];
export const STAFF_MANAGER_ROLES: UserRole[] = ['admin', 'super_admin'];

export const requireAdmin = requireRole(...ADMIN_ROLES);
export const requireSuperAdmin = requireRole('super_admin');
