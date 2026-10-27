import { Request, Response, Router } from 'express';
import { sendSuccess } from '../../utils/apiResponse';
import { asyncHandler } from '../../utils/asyncHandler';
import { requireAuth } from '../../middlewares/auth.middleware';
import { validate } from '../../middlewares/validate.middleware';
import { cartService } from './cart.service';
import {
  addCartItemSchema,
  cartItemIdParamSchema,
  syncCartSchema,
  updateCartItemSchema,
} from './cart.schemas';

export const cartController = {
  getCart: asyncHandler(async (req: Request, res: Response) => {
    const cart = await cartService.getCart(req.user!.id);
    sendSuccess(res, { cart });
  }),

  sync: asyncHandler(async (req: Request, res: Response) => {
    const { cart, skipped } = await cartService.syncCart(req.user!.id, req.body.items);
    sendSuccess(res, { cart, skipped }, 'Cart synced successfully');
  }),

  addItem: asyncHandler(async (req: Request, res: Response) => {
    const cart = await cartService.addItem(req.user!.id, req.body);
    sendSuccess(res, { cart }, 'Item added to cart', 201);
  }),

  updateItem: asyncHandler(async (req: Request, res: Response) => {
    const cart = await cartService.updateItemQuantity(
      req.user!.id,
      req.params.itemId,
      req.body.quantity
    );
    sendSuccess(res, { cart }, 'Cart item updated');
  }),

  removeItem: asyncHandler(async (req: Request, res: Response) => {
    const cart = await cartService.removeItem(req.user!.id, req.params.itemId);
    sendSuccess(res, { cart }, 'Item removed from cart');
  }),

  clear: asyncHandler(async (req: Request, res: Response) => {
    const cart = await cartService.clearCart(req.user!.id);
    sendSuccess(res, { cart }, 'Cart cleared');
  }),
};

const router = Router();
router.use(requireAuth);

router.get('/', cartController.getCart);
router.post('/sync', validate({ body: syncCartSchema }), cartController.sync);
router.post('/items', validate({ body: addCartItemSchema }), cartController.addItem);
router.patch(
  '/items/:itemId',
  validate({ params: cartItemIdParamSchema, body: updateCartItemSchema }),
  cartController.updateItem
);
router.delete(
  '/items/:itemId',
  validate({ params: cartItemIdParamSchema }),
  cartController.removeItem
);
router.delete('/', cartController.clear);

export default router;
