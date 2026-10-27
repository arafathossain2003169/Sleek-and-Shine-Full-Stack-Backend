import { Request, Response, Router } from 'express';
import { sendSuccess } from '../../../utils/apiResponse';
import { asyncHandler } from '../../../utils/asyncHandler';
import { validate } from '../../../middlewares/validate.middleware';
import { recordAuditSafely } from '../audit/audit.repository';
import { couponsService } from '../../coupons/coupons.service';
import { createCouponSchema, idParamSchema, updateCouponSchema } from '../../coupons/coupons.schemas';

const adminCouponsController = {
  list: asyncHandler(async (_req: Request, res: Response) => {
    const coupons = await couponsService.adminList();
    sendSuccess(res, { coupons });
  }),
  create: asyncHandler(async (req: Request, res: Response) => {
    const coupon = await couponsService.adminCreate(req.body);
    recordAuditSafely({ adminId: req.user!.id, action: 'create', entityType: 'coupon', entityId: coupon.id, newValue: coupon, ipAddress: req.ip });
    sendSuccess(res, { coupon }, 'Coupon created successfully', 201);
  }),
  update: asyncHandler(async (req: Request, res: Response) => {
    const { before, after: coupon } = await couponsService.adminUpdate(req.params.id, req.body);
    recordAuditSafely({ adminId: req.user!.id, action: 'update', entityType: 'coupon', entityId: req.params.id, oldValue: before, newValue: coupon, ipAddress: req.ip });
    sendSuccess(res, { coupon }, 'Coupon updated successfully');
  }),
  delete: asyncHandler(async (req: Request, res: Response) => {
    const deleted = await couponsService.adminDelete(req.params.id);
    recordAuditSafely({ adminId: req.user!.id, action: 'delete', entityType: 'coupon', entityId: req.params.id, oldValue: deleted, ipAddress: req.ip });
    sendSuccess(res, {}, 'Coupon deleted successfully');
  }),
};

const router = Router();
router.get('/', adminCouponsController.list);
router.post('/', validate({ body: createCouponSchema }), adminCouponsController.create);
router.patch('/:id', validate({ params: idParamSchema, body: updateCouponSchema }), adminCouponsController.update);
router.delete('/:id', validate({ params: idParamSchema }), adminCouponsController.delete);

export default router;
