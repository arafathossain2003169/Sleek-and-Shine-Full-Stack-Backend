import { Request, Response, Router } from 'express';
import { sendSuccess } from '../../../utils/apiResponse';
import { asyncHandler } from '../../../utils/asyncHandler';
import { validate } from '../../../middlewares/validate.middleware';
import { buildPaginationMeta, parsePagination } from '../../../utils/pagination';
import { recordAuditSafely } from '../audit/audit.repository';
import { getSettings } from '../../settings/settings.service';
import { inventoryRepository } from './inventory.repository';
import { adjustInventorySchema, listQuerySchema, movementsQuerySchema } from './inventory.schemas';

const adminInventoryController = {
  list: asyncHandler(async (req: Request, res: Response) => {
    const { page, limit, offset } = parsePagination(req.query as never);
    const q = req.query as { search?: string; lowStock?: string };
    const { rows, total } = await inventoryRepository.listStock(limit, offset, { search: q.search, lowStockOnly: q.lowStock === 'true' });
    sendSuccess(res, { inventory: rows, lowStockThreshold: (await getSettings()).lowStockThreshold }, 'Inventory fetched', 200, buildPaginationMeta(page, limit, total));
  }),

  lowStock: asyncHandler(async (_req: Request, res: Response) => {
    const items = await inventoryRepository.lowStock();
    sendSuccess(res, { items });
  }),

  movements: asyncHandler(async (req: Request, res: Response) => {
    const { page, limit, offset } = parsePagination(req.query as never);
    const { rows, total } = await inventoryRepository.movements(
      limit,
      offset,
      req.query.productId as string | undefined
    );
    sendSuccess(res, { movements: rows }, 'Movements fetched', 200, buildPaginationMeta(page, limit, total));
  }),

  adjust: asyncHandler(async (req: Request, res: Response) => {
    {
      const result = await inventoryRepository.adjustStock({
        productId: req.body.productId,
        variantId: req.body.variantId,
        newQuantity: req.body.newQuantity,
        reason: req.body.reason,
        note: req.body.note,
        adminId: req.user!.id,
      });
      recordAuditSafely({
        adminId: req.user!.id,
        action: 'inventory_adjust',
        entityType: 'product_variant',
        entityId: req.body.variantId,
        oldValue: { quantity: result.previousQuantity },
        newValue: { quantity: result.newQuantity, reason: req.body.reason },
        ipAddress: req.ip,
      });
      sendSuccess(res, { result }, 'Inventory adjusted successfully');
    }
  }),
};

const router = Router();
router.get('/', validate({ query: listQuerySchema }), adminInventoryController.list);
router.get('/low-stock', adminInventoryController.lowStock);
router.get('/movements', validate({ query: movementsQuerySchema }), adminInventoryController.movements);
router.patch('/adjust', validate({ body: adjustInventorySchema }), adminInventoryController.adjust);

export default router;
