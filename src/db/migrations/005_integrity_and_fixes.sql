-- 005_integrity_and_fixes.sql
-- Data-integrity fixes found during QA. Safe to run on existing data (cleans up first).

-- 1) Cart: NULL variant_id rows were never de-duplicated (NULLs are distinct in UNIQUE).
UPDATE cart_items ci
   SET quantity = LEAST(s.total, 99)
  FROM (
    SELECT DISTINCT ON (cart_id, product_id)
           id, SUM(quantity) OVER (PARTITION BY cart_id, product_id) AS total
      FROM cart_items
     WHERE variant_id IS NULL
     ORDER BY cart_id, product_id, created_at, id
  ) s
 WHERE ci.id = s.id;

DELETE FROM cart_items a
 USING cart_items b
 WHERE a.variant_id IS NULL AND b.variant_id IS NULL
   AND a.cart_id = b.cart_id AND a.product_id = b.product_id
   AND (a.created_at, a.id) > (b.created_at, b.id);

UPDATE cart_items SET quantity = 99 WHERE quantity > 99;
ALTER TABLE cart_items DROP CONSTRAINT IF EXISTS cart_items_quantity_max;
ALTER TABLE cart_items ADD CONSTRAINT cart_items_quantity_max CHECK (quantity <= 99);

CREATE UNIQUE INDEX IF NOT EXISTS uq_cart_items_no_variant
  ON cart_items (cart_id, product_id) WHERE variant_id IS NULL;

-- 2) Prices: a sale price must be positive and lower than the regular price.
UPDATE products SET sale_price = NULL
 WHERE sale_price IS NOT NULL AND (sale_price <= 0 OR sale_price >= base_price);
UPDATE product_variants SET sale_price = NULL
 WHERE sale_price IS NOT NULL AND (sale_price <= 0 OR (price IS NOT NULL AND sale_price >= price));

ALTER TABLE products DROP CONSTRAINT IF EXISTS products_sale_price_valid;
ALTER TABLE products ADD CONSTRAINT products_sale_price_valid
  CHECK (sale_price IS NULL OR (sale_price > 0 AND sale_price < base_price));
ALTER TABLE product_variants DROP CONSTRAINT IF EXISTS variants_sale_price_valid;
ALTER TABLE product_variants ADD CONSTRAINT variants_sale_price_valid
  CHECK (sale_price IS NULL OR (sale_price > 0 AND (price IS NULL OR sale_price < price)));
ALTER TABLE product_variants DROP CONSTRAINT IF EXISTS variants_stock_non_negative;
UPDATE product_variants SET stock_quantity = 0 WHERE stock_quantity < 0;
ALTER TABLE product_variants ADD CONSTRAINT variants_stock_non_negative CHECK (stock_quantity >= 0);

-- 3) SKUs: de-duplicate (keep the oldest), then enforce uniqueness (case-insensitive).
UPDATE products SET sku = NULL WHERE sku = '';
UPDATE products p SET sku = NULL
 WHERE sku IS NOT NULL AND id NOT IN (
   SELECT DISTINCT ON (lower(sku)) id FROM products WHERE sku IS NOT NULL ORDER BY lower(sku), created_at, id);
UPDATE product_variants SET sku = NULL WHERE sku = '';
UPDATE product_variants v SET sku = NULL
 WHERE sku IS NOT NULL AND id NOT IN (
   SELECT DISTINCT ON (lower(sku)) id FROM product_variants WHERE sku IS NOT NULL ORDER BY lower(sku), created_at, id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_products_sku ON products (lower(sku)) WHERE sku IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_product_variants_sku ON product_variants (lower(sku)) WHERE sku IS NOT NULL;

-- 4) Coupons: percentage cap, per-user limit.
UPDATE coupons SET value = 100 WHERE type = 'percentage' AND value > 100;
ALTER TABLE coupons DROP CONSTRAINT IF EXISTS coupons_percentage_max;
ALTER TABLE coupons ADD CONSTRAINT coupons_percentage_max CHECK (type <> 'percentage' OR value <= 100);
ALTER TABLE coupons ADD COLUMN IF NOT EXISTS per_user_limit INTEGER CHECK (per_user_limit IS NULL OR per_user_limit > 0);

-- 5) Orders remember the chosen payment provider (needed for COD -> paid on delivery).
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_provider VARCHAR(30);
UPDATE orders o SET payment_provider = (
  SELECT p.provider FROM payments p WHERE p.order_id = o.id ORDER BY p.created_at DESC LIMIT 1
) WHERE payment_provider IS NULL;

-- 6) Search / listing performance.
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_trgm;
  CREATE INDEX IF NOT EXISTS idx_products_name_trgm ON products USING gin (name gin_trgm_ops);
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_trgm not available - skipping trigram index (search still works, just slower)';
END $$;
CREATE INDEX IF NOT EXISTS idx_products_category_status ON products (category_id, status);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_product ON inventory_movements (product_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs (created_at DESC);
