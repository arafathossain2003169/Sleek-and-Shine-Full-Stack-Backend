import { Request, Response, Router } from 'express';
import { sendSuccess } from '../../../utils/apiResponse';
import { asyncHandler } from '../../../utils/asyncHandler';
import { validate } from '../../../middlewares/validate.middleware';
import { recordAuditSafely } from '../audit/audit.repository';
import { brandsService } from '../../brands/brands.service';
import { createBrandSchema, idParamSchema, updateBrandSchema } from '../../brands/brands.schemas';

const adminBrandsController = {
  list: asyncHandler(async (_req: Request, res: Response) => {
    const brands = await brandsService.adminList();
    sendSuccess(res, { brands });
  }),
  create: asyncHandler(async (req: Request, res: Response) => {
    const brand = await brandsService.adminCreate(req.body);
    recordAuditSafely({ adminId: req.user!.id, action: 'create', entityType: 'brand', entityId: brand.id, newValue: brand, ipAddress: req.ip });
    sendSuccess(res, { brand }, 'Brand created successfully', 201);
  }),
  update: asyncHandler(async (req: Request, res: Response) => {
    const { before, after: brand } = await brandsService.adminUpdate(req.params.id, req.body);
    recordAuditSafely({ adminId: req.user!.id, action: 'update', entityType: 'brand', entityId: req.params.id, oldValue: before, newValue: brand, ipAddress: req.ip });
    sendSuccess(res, { brand }, 'Brand updated successfully');
  }),
  delete: asyncHandler(async (req: Request, res: Response) => {
    const deleted = await brandsService.adminDelete(req.params.id);
    recordAuditSafely({ adminId: req.user!.id, action: 'delete', entityType: 'brand', entityId: req.params.id, oldValue: deleted, ipAddress: req.ip });
    sendSuccess(res, {}, 'Brand deleted successfully');
  }),
};

const router = Router();
router.get('/', adminBrandsController.list);
router.post('/', validate({ body: createBrandSchema }), adminBrandsController.create);
router.patch('/:id', validate({ params: idParamSchema, body: updateBrandSchema }), adminBrandsController.update);
router.delete('/:id', validate({ params: idParamSchema }), adminBrandsController.delete);

export default router;
