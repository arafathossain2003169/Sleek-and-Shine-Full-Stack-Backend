import { Request, Response, Router } from 'express';
import { query } from '../../../config/db';
import { getSettings } from '../../settings/settings.service';
import { sendSuccess } from '../../../utils/apiResponse';
import { asyncHandler } from '../../../utils/asyncHandler';

const dashboardRepository = {
  async getStats() {
    const { lowStockThreshold } = await getSettings();
    const [
      revenueResult,
      orderCountResult,
      productCountResult,
      lowStockResult,
      recentOrdersResult,
      lowStockListResult,
      pendingOrdersResult,
    ] = await Promise.all([
      query<{ total: string }>(
        `SELECT COALESCE(SUM(total), 0)::text AS total FROM orders
         WHERE payment_status = 'paid' AND status NOT IN ('cancelled', 'returned', 'refunded')`
      ),
      query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM orders WHERE status NOT IN ('cancelled', 'failed_payment')`),
      query<{ count: string }>('SELECT COUNT(*)::text AS count FROM products'),
      query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM product_variants WHERE stock_quantity <= $1 AND status = 'active'`,
        [lowStockThreshold]
      ),
      query(
        `SELECT o.id, o.order_number, o.status, o.payment_status, o.total, o.created_at, u.name AS customer_name
         FROM orders o JOIN users u ON u.id = o.user_id
         ORDER BY o.created_at DESC, o.id ASC LIMIT 10`
      ),
      query(
        `SELECT v.id AS variant_id, v.name AS variant_name, v.stock_quantity, p.name AS product_name, p.slug AS product_slug
         FROM product_variants v JOIN products p ON p.id = v.product_id
         WHERE v.stock_quantity <= $1 AND v.status = 'active'
         ORDER BY v.stock_quantity ASC, v.id ASC LIMIT 10`,
        [lowStockThreshold]
      ),
      query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM orders WHERE status IN ('pending', 'confirmed')`),
    ]);
    const pendingResult = parseInt(pendingOrdersResult.rows[0].count, 10);

    return {
      totalRevenue: Number(revenueResult.rows[0].total),
      pendingOrders: pendingResult,
      orderCount: parseInt(orderCountResult.rows[0].count, 10),
      productCount: parseInt(productCountResult.rows[0].count, 10),
      lowStockThreshold,
      lowStockCount: parseInt(lowStockResult.rows[0].count, 10),
      recentOrders: recentOrdersResult.rows.map((o) => ({ ...o, total: Number(o.total) })),
      lowStockItems: lowStockListResult.rows,
    };
  },
};

const dashboardController = {
  stats: asyncHandler(async (_req: Request, res: Response) => {
    const stats = await dashboardRepository.getStats();
    sendSuccess(res, stats, 'Dashboard stats fetched');
  }),
};

const router = Router();
router.get('/stats', dashboardController.stats);

export default router;
