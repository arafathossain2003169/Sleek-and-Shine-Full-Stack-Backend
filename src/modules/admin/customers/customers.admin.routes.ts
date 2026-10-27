import { Request, Response, Router } from 'express';
import { z } from 'zod';
import { sendSuccess } from '../../../utils/apiResponse';
import { asyncHandler } from '../../../utils/asyncHandler';
import { validate } from '../../../middlewares/validate.middleware';
import { buildPaginationMeta, parsePagination } from '../../../utils/pagination';
import { NotFoundError } from '../../../utils/errors';
import { recordAuditSafely } from '../audit/audit.repository';
import { authRepository } from '../../auth/auth.repository';
import { digitsString, emptyToUndefined } from '../../../utils/validators';
import { customersRepository } from './customers.repository';

const idParamSchema = z.object({ id: z.string().uuid() });
const updateStatusSchema = z.object({ status: z.enum(['active', 'blocked', 'deleted']) });
const listQuerySchema = z.object({
  page: digitsString.optional(),
  limit: digitsString.optional(),
  search: z.preprocess(emptyToUndefined, z.string().trim().max(100).optional()),
});

const adminCustomersController = {
  list: asyncHandler(async (req: Request, res: Response) => {
    const { page, limit, offset } = parsePagination(req.query as never);
    const { rows, total } = await customersRepository.list(
      limit,
      offset,
      req.query.search as string | undefined
    );
    sendSuccess(res, { customers: rows }, 'Customers fetched', 200, buildPaginationMeta(page, limit, total));
  }),

  getById: asyncHandler(async (req: Request, res: Response) => {
    const customer = await customersRepository.findById(req.params.id);
    if (!customer) throw new NotFoundError('Customer not found');
    sendSuccess(res, { customer });
  }),

  updateStatus: asyncHandler(async (req: Request, res: Response) => {
    const customer = await customersRepository.updateStatus(req.params.id, req.body.status);
    if (!customer) throw new NotFoundError('Customer not found');
    // A blocked/deleted customer must lose access immediately, not when their token expires.
    if (req.body.status !== 'active') await authRepository.revokeAllUserRefreshTokens(req.params.id);
    recordAuditSafely({
      adminId: req.user!.id,
      action: 'update_status',
      entityType: 'customer',
      entityId: req.params.id,
      newValue: { status: req.body.status },
      ipAddress: req.ip,
    });
    sendSuccess(res, { customer }, 'Customer status updated');
  }),
};

const router = Router();
router.get('/', validate({ query: listQuerySchema }), adminCustomersController.list);
router.get('/:id', validate({ params: idParamSchema }), adminCustomersController.getById);
router.patch(
  '/:id/status',
  validate({ params: idParamSchema, body: updateStatusSchema }),
  adminCustomersController.updateStatus
);

export default router;
