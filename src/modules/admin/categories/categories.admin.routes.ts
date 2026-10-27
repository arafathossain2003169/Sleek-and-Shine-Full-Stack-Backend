import { Request, Response } from 'express';
import { Router } from 'express';
import { sendSuccess } from '../../../utils/apiResponse';
import { asyncHandler } from '../../../utils/asyncHandler';
import { validate } from '../../../middlewares/validate.middleware';
import { recordAuditSafely } from '../audit/audit.repository';
import { categoriesService } from '../../categories/categories.service';
import {
  createCategorySchema,
  idParamSchema,
  updateCategorySchema,
} from '../../categories/categories.schemas';

const adminCategoriesController = {
  list: asyncHandler(async (_req: Request, res: Response) => {
    const categories = await categoriesService.adminList();
    sendSuccess(res, { categories });
  }),

  create: asyncHandler(async (req: Request, res: Response) => {
    const category = await categoriesService.adminCreate(req.body);
    recordAuditSafely({
      adminId: req.user!.id,
      action: 'create',
      entityType: 'category',
      entityId: category.id,
      newValue: category,
      ipAddress: req.ip,
    });
    sendSuccess(res, { category }, 'Category created successfully', 201);
  }),

  update: asyncHandler(async (req: Request, res: Response) => {
    const { before, after: category } = await categoriesService.adminUpdate(req.params.id, req.body);
    recordAuditSafely({
      adminId: req.user!.id,
      action: 'update',
      entityType: 'category',
      entityId: req.params.id,
      oldValue: before,
      newValue: category,
      ipAddress: req.ip,
    });
    sendSuccess(res, { category }, 'Category updated successfully');
  }),

  delete: asyncHandler(async (req: Request, res: Response) => {
    const deleted = await categoriesService.adminDelete(req.params.id);
    recordAuditSafely({
      adminId: req.user!.id,
      action: 'delete',
      entityType: 'category',
      entityId: req.params.id,
      oldValue: deleted,
      ipAddress: req.ip,
    });
    sendSuccess(res, {}, 'Category deleted successfully');
  }),
};

const router = Router();

router.get('/', adminCategoriesController.list);
router.post('/', validate({ body: createCategorySchema }), adminCategoriesController.create);
router.patch(
  '/:id',
  validate({ params: idParamSchema, body: updateCategorySchema }),
  adminCategoriesController.update
);
router.delete('/:id', validate({ params: idParamSchema }), adminCategoriesController.delete);

export default router;
