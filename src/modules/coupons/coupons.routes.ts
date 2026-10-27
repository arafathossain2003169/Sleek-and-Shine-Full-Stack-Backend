import { Request, Response, Router } from 'express';
import { sendSuccess } from '../../utils/apiResponse';
import { asyncHandler } from '../../utils/asyncHandler';
import { requireAuth } from '../../middlewares/auth.middleware';
import { couponRateLimiter } from '../../middlewares/rateLimit.middleware';
import { validate } from '../../middlewares/validate.middleware';
import { couponsService } from './coupons.service';
import { validateCouponSchema } from './coupons.schemas';

export const couponsController = {
  validate: asyncHandler(async (req: Request, res: Response) => {
    const result = await couponsService.validate(req.body.code, req.body.orderAmount ?? 0, req.user!.id);
    sendSuccess(res, { coupon: result }, 'Coupon is valid');
  }),
};

const router = Router();
router.post('/validate', requireAuth, couponRateLimiter, validate({ body: validateCouponSchema }), couponsController.validate);

export default router;
