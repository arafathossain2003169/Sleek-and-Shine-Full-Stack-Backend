import { PoolClient } from 'pg';
import { getSettings } from '../modules/settings/settings.service';

/**
 * Keeps products.stock_status in sync with the numeric variant stock.
 * 'discontinued' is a manual decision and is never overwritten.
 */
export async function syncProductStockStatus(client: PoolClient, productId: string): Promise<void> {
  const { lowStockThreshold } = await getSettings();
  await client.query(
    `UPDATE products p SET
       stock_status = CASE
         WHEN agg.variant_count = 0 THEN p.stock_status
         WHEN agg.total <= 0 THEN 'out_of_stock'
         WHEN agg.total <= $2 THEN 'low_stock'
         ELSE 'in_stock' END,
       updated_at = now()
     FROM (
       SELECT COUNT(*)::int AS variant_count, COALESCE(SUM(stock_quantity), 0)::int AS total
       FROM product_variants WHERE product_id = $1 AND status = 'active'
     ) agg
     WHERE p.id = $1 AND p.stock_status <> 'discontinued'`,
    [productId, lowStockThreshold]
  );
}
