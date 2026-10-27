import { Request, Response, Router } from 'express';
import { sendSuccess } from '../../utils/apiResponse';
import { asyncHandler } from '../../utils/asyncHandler';
import { requireAuth } from '../../middlewares/auth.middleware';
import { checkoutRateLimiter } from '../../middlewares/rateLimit.middleware';
import { validate } from '../../middlewares/validate.middleware';
import { checkoutService } from './checkout.service';
import { checkoutSchema, quoteSchema } from './checkout.schemas';

export const checkoutController = {
  quote: asyncHandler(async (req: Request, res: Response) => {
    const quote = await checkoutService.quote(req.user!.id, req.body.couponCode);
    sendSuccess(res, { quote }, 'Checkout quote calculated');
  }),

  placeOrder: asyncHandler(async (req: Request, res: Response) => {
    const order = await checkoutService.placeOrder(req.user!.id, req.body);
    sendSuccess(res, { order }, 'Order placed successfully', 201);
  }),
};

const router = Router();
router.post('/quote', requireAuth, validate({ body: quoteSchema }), checkoutController.quote);
router.post('/', requireAuth, checkoutRateLimiter, validate({ body: checkoutSchema }), checkoutController.placeOrder);

export default router;
