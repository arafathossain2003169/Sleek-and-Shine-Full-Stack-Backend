import { Request, Response, Router } from 'express';
import { z } from 'zod';
import { query } from '../../../config/db';
import { sendSuccess } from '../../../utils/apiResponse';
import { asyncHandler } from '../../../utils/asyncHandler';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../../../utils/errors';
import { hashPassword } from '../../../utils/password';
import { escapeLike } from '../../../utils/sql';
import { validate } from '../../../middlewares/validate.middleware';
import { authRepository } from '../../auth/auth.repository';
import { phoneSchema } from '../../auth/auth.schemas';
import { recordAuditSafely } from '../audit/audit.repository';

const ROLES = ['customer', 'order_manager', 'inventory_staff', 'manager', 'admin', 'super_admin'] as const;
type Role = (typeof ROLES)[number];

const idParamSchema = z.object({ id: z.string().uuid() });
const searchQuerySchema = z.object({ search: z.string().trim().min(2, 'Type at least 2 characters').max(100) });

const createStaffSchema = z.object({
  name: z.string().trim().min(2).max(150),
  email: z.string().trim().toLowerCase().email().max(255),
  password: z
    .string()
    .min(10, 'Staff passwords must be at least 10 characters')
    .refine((v) => Buffer.byteLength(v) <= 72, 'Password too long')
    .refine((v) => /[A-Za-z]/.test(v) && /\d/.test(v), 'Needs a letter and a number'),
  phone: phoneSchema.optional(),
  role: z.enum(ROLES).refine((r) => r !== 'customer', 'Pick a staff role'),
});

const updateSchema = z
  .object({ role: z.enum(ROLES).optional(), status: z.enum(['active', 'blocked']).optional() })
  .refine((v) => v.role !== undefined || v.status !== undefined, 'Nothing to update');

const SAFE = 'id, name, email, phone, role, status, email_verified, created_at';

/**
 * Who may do what:
 *  - admins and super admins manage accounts;
 *  - only a super admin may grant, change or revoke the super_admin role (so an admin can never escalate);
 *  - nobody changes their own role/status, and the last active super admin can never be removed.
 */
async function assertMayChange(actor: { id: string; role: Role }, target: { id: string; role: Role }, next: { role?: Role; status?: string }) {
  if (target.id === actor.id) throw new BadRequestError('You cannot change your own role or status');
  const touchesSuper = target.role === 'super_admin' || next.role === 'super_admin';
  if (touchesSuper && actor.role !== 'super_admin') {
    throw new ForbiddenError('Only a super admin can grant or change the super admin role');
  }
  const losingSuper =
    target.role === 'super_admin' && ((next.role !== undefined && next.role !== 'super_admin') || next.status === 'blocked');
  if (losingSuper) {
    const others = await query<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM users WHERE role = 'super_admin' AND status = 'active' AND id <> $1`,
      [target.id]
    );
    if (parseInt(others.rows[0].c, 10) === 0) throw new BadRequestError('There must always be at least one active super admin');
  }
}

const controller = {
  /** Everyone with a staff role. */
  list: asyncHandler(async (_req: Request, res: Response) => {
    const r = await query(`SELECT ${SAFE} FROM users WHERE role <> 'customer' ORDER BY created_at ASC`);
    sendSuccess(res, { staff: r.rows });
  }),

  /** Find any account (customers included) so it can be promoted. */
  searchUsers: asyncHandler(async (req: Request, res: Response) => {
    const term = `%${escapeLike((req.query as { search: string }).search)}%`;
    const r = await query(
      `SELECT ${SAFE} FROM users WHERE status <> 'deleted' AND (email ILIKE $1 OR name ILIKE $1)
       ORDER BY (role <> 'customer') DESC, email ASC LIMIT 10`,
      [term]
    );
    sendSuccess(res, { users: r.rows });
  }),

  create: asyncHandler(async (req: Request, res: Response) => {
    if (req.body.role === 'super_admin' && req.user!.role !== 'super_admin') {
      throw new ForbiddenError('Only a super admin can create another super admin');
    }
    if (await authRepository.findByEmail(req.body.email)) throw new ConflictError('An account with this email already exists');
    const user = await authRepository.createUser({
      name: req.body.name,
      email: req.body.email,
      phone: req.body.phone,
      passwordHash: await hashPassword(req.body.password),
      role: req.body.role,
    });
    recordAuditSafely({
      adminId: req.user!.id, action: 'create', entityType: 'staff', entityId: user.id,
      newValue: { email: user.email, role: user.role }, ipAddress: req.ip,
    });
    sendSuccess(res, { staff: { id: user.id, name: user.name, email: user.email, role: user.role, status: user.status } }, 'Staff account created', 201);
  }),

  /** Change the role (promote a customer, demote staff) and/or block/unblock any account. */
  update: asyncHandler(async (req: Request, res: Response) => {
    const id = req.params.id;
    const target = (await query<{ id: string; role: Role; status: string } & Record<string, unknown>>(`SELECT ${SAFE} FROM users WHERE id = $1 AND status <> 'deleted'`, [id])).rows[0];
    if (!target) throw new NotFoundError('Account not found');
    await assertMayChange({ id: req.user!.id, role: req.user!.role as Role }, target, req.body);
    if (req.body.role && req.body.role !== 'customer' && target.status !== 'active') {
      throw new BadRequestError('This account is blocked. Unblock it before giving it a staff role.');
    }

    const r = await query(
      `UPDATE users SET role = COALESCE($2, role), status = COALESCE($3, status), updated_at = now()
       WHERE id = $1 RETURNING ${SAFE}`,
      [id, req.body.role ?? null, req.body.status ?? null]
    );
    // Takes effect immediately: access tokens are checked against the database, and refresh tokens are revoked.
    await authRepository.revokeAllUserRefreshTokens(id);
    recordAuditSafely({
      adminId: req.user!.id, action: req.body.role ? 'change_role' : 'update', entityType: 'staff', entityId: id,
      oldValue: target, newValue: r.rows[0], ipAddress: req.ip,
    });
    sendSuccess(res, { user: r.rows[0] }, 'Account updated');
  }),
};

const router = Router();
router.get('/', controller.list);
router.get('/users', validate({ query: searchQuerySchema }), controller.searchUsers);
router.post('/', validate({ body: createStaffSchema }), controller.create);
router.patch('/:id', validate({ params: idParamSchema, body: updateSchema }), controller.update);

export default router;
