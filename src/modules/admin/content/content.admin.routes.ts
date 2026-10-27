import { Request, Response, Router } from 'express';
import { sendSuccess } from '../../../utils/apiResponse';
import { asyncHandler } from '../../../utils/asyncHandler';
import { validate } from '../../../middlewares/validate.middleware';
import { recordAuditSafely } from '../audit/audit.repository';
import { contentService } from '../../content/content.service';
import {
  createSectionSchema,
  idParamSchema,
  updateSectionSchema,
} from '../../content/content.schemas';

const adminContentController = {
  list: asyncHandler(async (_req: Request, res: Response) => {
    const sections = await contentService.adminList();
    sendSuccess(res, { sections });
  }),
  create: asyncHandler(async (req: Request, res: Response) => {
    const section = await contentService.adminCreate(req.body);
    recordAuditSafely({ adminId: req.user!.id, action: 'create', entityType: 'homepage_section', entityId: section.id, newValue: section, ipAddress: req.ip });
    sendSuccess(res, { section }, 'Homepage section created', 201);
  }),
  update: asyncHandler(async (req: Request, res: Response) => {
    const { before, after: section } = await contentService.adminUpdate(req.params.id, req.body);
    recordAuditSafely({ adminId: req.user!.id, action: 'update', entityType: 'homepage_section', entityId: req.params.id, oldValue: before, newValue: section, ipAddress: req.ip });
    sendSuccess(res, { section }, 'Homepage section updated');
  }),
  delete: asyncHandler(async (req: Request, res: Response) => {
    const deleted = await contentService.adminDelete(req.params.id);
    recordAuditSafely({ adminId: req.user!.id, action: 'delete', entityType: 'homepage_section', entityId: req.params.id, oldValue: deleted, ipAddress: req.ip });
    sendSuccess(res, {}, 'Homepage section deleted');
  }),
};

const router = Router();
router.get('/', adminContentController.list);
router.get('/homepage', adminContentController.list);
router.post('/homepage', validate({ body: createSectionSchema }), adminContentController.create);
router.patch('/homepage/:id', validate({ params: idParamSchema, body: updateSectionSchema }), adminContentController.update);
router.delete('/homepage/:id', validate({ params: idParamSchema }), adminContentController.delete);
router.post('/', validate({ body: createSectionSchema }), adminContentController.create);
router.patch('/:id', validate({ params: idParamSchema, body: updateSectionSchema }), adminContentController.update);
router.delete('/:id', validate({ params: idParamSchema }), adminContentController.delete);

export default router;
