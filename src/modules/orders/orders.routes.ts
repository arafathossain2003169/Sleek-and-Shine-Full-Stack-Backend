import { Request, Response, Router } from 'express';
import { sendSuccess } from '../../utils/apiResponse';
import { asyncHandler } from '../../utils/asyncHandler';
import { requireAuth } from '../../middlewares/auth.middleware';
import { validate } from '../../middlewares/validate.middleware';
import { ordersService } from './orders.service';
import { orderNumberParamSchema, listQuerySchema } from './orders.schemas';

export const ordersController = {
  listMy: asyncHandler(async (req: Request, res: Response) => {
    const { orders, meta } = await ordersService.listMyOrders(req.user!.id, req.query as never);
    sendSuccess(res, { orders }, 'Orders fetched', 200, meta);
  }),

  cancelMy: asyncHandler(async (req: Request, res: Response) => {
    const order = await ordersService.cancelMyOrder(req.user!.id, req.params.orderNumber);
    sendSuccess(res, { order }, 'Order cancelled');
  }),

  getMy: asyncHandler(async (req: Request, res: Response) => {
    const order = await ordersService.getMyOrder(req.user!.id, req.params.orderNumber);
    sendSuccess(res, { order });
  }),
};

const router = Router();
router.use(requireAuth);
router.get('/my', validate({ query: listQuerySchema }), ordersController.listMy);
router.get(
  '/my/:orderNumber',
  validate({ params: orderNumberParamSchema }),
  ordersController.getMy
);

router.post(
  '/my/:orderNumber/cancel',
  validate({ params: orderNumberParamSchema }),
  ordersController.cancelMy
);

export default router;
