import { Request, Response, Router } from 'express';
import { z } from 'zod';
import { sendSuccess } from '../../../utils/apiResponse';
import { asyncHandler } from '../../../utils/asyncHandler';
import { validate } from '../../../middlewares/validate.middleware';
import { buildPaginationMeta, parsePagination } from '../../../utils/pagination';
import { auditRepository } from './audit.repository';

const listQuerySchema = z.object({
  page: z.string().regex(/^\d{1,9}$/).optional(),
  limit: z.string().regex(/^\d{1,9}$/).optional(),
  entityType: z.string().trim().max(50).optional(),
  action: z.string().trim().max(50).optional(),
  adminId: z.string().uuid().optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
});

const auditLogsController = {
  list: asyncHandler(async (req: Request, res: Response) => {
    const { page, limit, offset } = parsePagination(req.query as never);
    const { rows, total } = await auditRepository.list({
      limit,
      offset,
      ...(req.query as Record<string, string | undefined>),
    });
    sendSuccess(res, { auditLogs: rows }, 'Audit logs fetched', 200, buildPaginationMeta(page, limit, total));
  }),
};

const router = Router();
router.get('/', validate({ query: listQuerySchema }), auditLogsController.list);

export default router;
