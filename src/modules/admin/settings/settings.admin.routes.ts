import { Request, Response, Router } from 'express';
import { z } from 'zod';
import { sendSuccess } from '../../../utils/apiResponse';
import { asyncHandler } from '../../../utils/asyncHandler';
import { validate } from '../../../middlewares/validate.middleware';
import { settingsService } from '../../settings/settings.service';
import { recordAuditSafely } from '../audit/audit.repository';

const updateSchema = z.object({
  // number = set, null = reset to the environment default
  values: z.record(z.string(), z.number().nullable()).refine((v) => Object.keys(v).length > 0, 'Nothing to update'),
});

const router = Router();

router.get(
  '/',
  asyncHandler(async (_req: Request, res: Response) => {
    sendSuccess(res, { settings: await settingsService.listForAdmin() }, 'Settings fetched');
  })
);

router.patch(
  '/',
  validate({ body: updateSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { before, after } = await settingsService.update(req.body.values, req.user!.id);
    recordAuditSafely({
      adminId: req.user!.id, action: 'update', entityType: 'settings',
      oldValue: before, newValue: after, ipAddress: req.ip,
    });
    sendSuccess(res, { settings: await settingsService.listForAdmin() }, 'Settings saved');
  })
);

export default router;
