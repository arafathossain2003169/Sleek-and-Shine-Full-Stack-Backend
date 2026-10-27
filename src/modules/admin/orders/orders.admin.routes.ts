import { Request, Response, Router } from 'express';
import { sendSuccess } from '../../../utils/apiResponse';
import { asyncHandler } from '../../../utils/asyncHandler';
import { validate } from '../../../middlewares/validate.middleware';
import { recordAuditSafely } from '../audit/audit.repository';
import { ordersService } from '../../orders/orders.service';
import {
  idParamSchema,
  listOrdersQuerySchema,
  updateAdminNoteSchema,
  updateOrderStatusSchema,
  updatePaymentStatusSchema,
} from './orders.admin.schemas';

const adminOrdersController = {
  list: asyncHandler(async (req: Request, res: Response) => {
    const { orders, meta } = await ordersService.adminList(req.query as never);
    sendSuccess(res, { orders }, 'Orders fetched', 200, meta);
  }),

  getById: asyncHandler(async (req: Request, res: Response) => {
    const order = await ordersService.adminGetById(req.params.id);
    sendSuccess(res, { order });
  }),

  updateStatus: asyncHandler(async (req: Request, res: Response) => {
    const { before, after: order } = await ordersService.adminUpdateStatus(
      req.params.id,
      req.body.status,
      req.user!.id,
      req.body.note
    );
    recordAuditSafely({
      adminId: req.user!.id,
      action: 'update_status',
      entityType: 'order',
      entityId: req.params.id,
      oldValue: { status: before.status },
      newValue: { status: req.body.status, note: req.body.note },
      ipAddress: req.ip,
    });
    sendSuccess(res, { order }, 'Order status updated');
  }),

  updatePaymentStatus: asyncHandler(async (req: Request, res: Response) => {
    const { before, after } = await ordersService.adminUpdatePaymentStatus(
      req.params.id,
      req.body.paymentStatus,
      req.body.transactionId
    );
    recordAuditSafely({
      adminId: req.user!.id,
      action: 'update_payment_status',
      entityType: 'order',
      entityId: req.params.id,
      oldValue: before,
      newValue: after,
      ipAddress: req.ip,
    });
    const order = await ordersService.adminGetById(req.params.id);
    sendSuccess(res, { order }, 'Payment status updated');
  }),

  updateAdminNote: asyncHandler(async (req: Request, res: Response) => {
    const order = await ordersService.adminUpdateNote(req.params.id, req.body.note);
    recordAuditSafely({
      adminId: req.user!.id,
      action: 'update_admin_note',
      entityType: 'order',
      entityId: req.params.id,
      ipAddress: req.ip,
    });
    sendSuccess(res, { order }, 'Order note updated');
  }),
};

const router = Router();
router.get('/', validate({ query: listOrdersQuerySchema }), adminOrdersController.list);
router.get('/:id', validate({ params: idParamSchema }), adminOrdersController.getById);
router.patch(
  '/:id/status',
  validate({ params: idParamSchema, body: updateOrderStatusSchema }),
  adminOrdersController.updateStatus
);
router.patch(
  '/:id/payment-status',
  validate({ params: idParamSchema, body: updatePaymentStatusSchema }),
  adminOrdersController.updatePaymentStatus
);
router.patch(
  '/:id/admin-note',
  validate({ params: idParamSchema, body: updateAdminNoteSchema }),
  adminOrdersController.updateAdminNote
);

export default router;
