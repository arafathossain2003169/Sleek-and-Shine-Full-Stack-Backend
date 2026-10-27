import { PoolClient } from 'pg';
import { env } from '../../config/env';
import { query, withTransaction } from '../../config/db';
import { escapeLike, updateRow } from '../../utils/sql';
import { syncProductStockStatus } from '../../utils/stockStatus';

export interface ProductListFilters {
  search?: string;
  categorySlug?: string;
  brandSlug?: string;
  minPrice?: number;
  maxPrice?: number;
  sort?: string;
  isNewArrival?: boolean;
  isOffer?: boolean;
  isFeatured?: boolean;
  attributes?: Record<string, unknown>;
  statusIn?: string[]; // admin only; when absent the query is the public storefront query
  limit: number;
  offset: number;
}

/** A sale price only applies when it is positive and lower than the regular price. */
const EFFECTIVE_PRICE = `(CASE WHEN p.sale_price IS NOT NULL AND p.sale_price > 0 AND p.sale_price < p.base_price THEN p.sale_price ELSE p.base_price END)`;

const PRODUCT_BASE_SELECT = `
  SELECT
    p.*,
    b.name AS brand_name, b.slug AS brand_slug,
    c.name AS category_name, c.slug AS category_slug,
    (SELECT COUNT(*)::int FROM product_variants pv WHERE pv.product_id = p.id AND pv.status = 'active') AS active_variant_count,
    (SELECT COALESCE(SUM(pv.stock_quantity), 0)::int FROM product_variants pv WHERE pv.product_id = p.id) AS total_stock,
    COALESCE(
      (SELECT json_agg(json_build_object(
        'id', pi.id, 'url', pi.url, 'altText', pi.alt_text,
        'sortOrder', pi.sort_order, 'isMain', pi.is_main
      ) ORDER BY pi.is_main DESC, pi.sort_order ASC, pi.created_at ASC)
      FROM product_images pi WHERE pi.product_id = p.id AND pi.variant_id IS NULL),
      '[]'
    ) AS images
  FROM products p
  LEFT JOIN brands b ON b.id = p.brand_id
  LEFT JOIN categories c ON c.id = p.category_id
`;

const PUBLIC_VISIBILITY = `p.status = 'published' AND c.is_active = TRUE AND (b.id IS NULL OR b.is_active = TRUE)`;

function sortClause(sort?: string): string {
  switch (sort) {
    case 'price_asc':
      return `ORDER BY ${EFFECTIVE_PRICE} ASC, p.id ASC`;
    case 'price_desc':
      return `ORDER BY ${EFFECTIVE_PRICE} DESC, p.id ASC`;
    case 'name_asc':
      return 'ORDER BY p.name ASC, p.id ASC';
    case 'discount':
      return `ORDER BY (CASE WHEN ${EFFECTIVE_PRICE} < p.base_price
                THEN (p.base_price - ${EFFECTIVE_PRICE}) / NULLIF(p.base_price, 0) ELSE 0 END) DESC, p.id ASC`;
    case 'best_selling':
      return `ORDER BY COALESCE((
                SELECT SUM(oi.quantity) FROM order_items oi JOIN orders o ON o.id = oi.order_id
                WHERE oi.product_id = p.id
                  AND o.status NOT IN ('cancelled','failed_payment','returned','refunded')), 0) DESC,
              p.created_at DESC, p.id ASC`;
    case 'newest':
    default:
      return 'ORDER BY p.created_at DESC, p.id ASC';
  }
}

function buildWhere(filters: ProductListFilters): { clause: string; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (filters.statusIn) {
    params.push(filters.statusIn);
    clauses.push(`p.status = ANY($${params.length}::varchar[])`);
  } else {
    clauses.push(PUBLIC_VISIBILITY);
  }

  if (filters.search) {
    params.push(`%${escapeLike(filters.search)}%`);
    const n = params.length;
    clauses.push(`(p.name ILIKE $${n} OR p.short_description ILIKE $${n} OR b.name ILIKE $${n})`);
  }
  if (filters.categorySlug) {
    params.push(filters.categorySlug);
    // A category page includes everything in its sub-categories.
    clauses.push(`p.category_id IN (
      WITH RECURSIVE tree AS (
        SELECT id FROM categories WHERE slug = $${params.length}
        UNION
        SELECT c2.id FROM categories c2 JOIN tree t ON c2.parent_id = t.id
      ) SELECT id FROM tree)`);
  }
  if (filters.brandSlug) {
    params.push(filters.brandSlug);
    clauses.push(`b.slug = $${params.length}`);
  }
  if (filters.minPrice !== undefined) {
    params.push(filters.minPrice);
    clauses.push(`${EFFECTIVE_PRICE} >= $${params.length}`);
  }
  if (filters.maxPrice !== undefined) {
    params.push(filters.maxPrice);
    clauses.push(`${EFFECTIVE_PRICE} <= $${params.length}`);
  }
  if (filters.isNewArrival !== undefined) {
    params.push(filters.isNewArrival);
    clauses.push(`p.is_new_arrival = $${params.length}`);
  }
  if (filters.isOffer !== undefined) {
    params.push(filters.isOffer);
    clauses.push(`p.is_offer = $${params.length}`);
  }
  if (filters.isFeatured !== undefined) {
    params.push(filters.isFeatured);
    clauses.push(`p.is_featured = $${params.length}`);
  }
  if (filters.attributes && Object.keys(filters.attributes).length > 0) {
    params.push(JSON.stringify(filters.attributes));
    clauses.push(`p.attributes @> $${params.length}::jsonb`);
  }

  return { clause: `WHERE ${clauses.join(' AND ')}`, params };
}

const PRODUCT_COLUMNS = {
  name: 'name',
  slug: 'slug',
  shortDescription: 'short_description',
  fullDescription: 'full_description',
  brandId: 'brand_id',
  categoryId: 'category_id',
  basePrice: 'base_price',
  salePrice: 'sale_price',
  sku: 'sku',
  barcode: 'barcode',
  stockStatus: 'stock_status',
  status: 'status',
  isFeatured: 'is_featured',
  isNewArrival: 'is_new_arrival',
  isOffer: 'is_offer',
  attributes: { column: 'attributes', json: true },
  seoTitle: 'seo_title',
  seoDescription: 'seo_description',
};

const VARIANT_COLUMNS = {
  name: 'name',
  sku: 'sku',
  barcode: 'barcode',
  price: 'price',
  salePrice: 'sale_price',
  attributes: { column: 'attributes', json: true },
  imageUrl: 'image_url',
  status: 'status',
};

export const productsRepository = {
  async list(filters: ProductListFilters) {
    const { clause, params } = buildWhere(filters);
    const fromJoins = `FROM products p
       LEFT JOIN brands b ON b.id = p.brand_id
       LEFT JOIN categories c ON c.id = p.category_id`;

    const countResult = await query<{ count: string }>(
      `SELECT COUNT(*)::text AS count ${fromJoins} ${clause}`,
      params
    );
    const total = parseInt(countResult.rows[0].count, 10);

    const dataParams = [...params, filters.limit, filters.offset];
    const dataResult = await query(
      `${PRODUCT_BASE_SELECT}
       ${clause}
       ${sortClause(filters.sort)}
       LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`,
      dataParams
    );

    return { rows: dataResult.rows, total };
  },

  async findBySlug(slug: string, publicOnly = true) {
    const result = await query(
      `${PRODUCT_BASE_SELECT}
       WHERE p.slug = $1 ${publicOnly ? `AND ${PUBLIC_VISIBILITY}` : ''}`,
      [slug]
    );
    return result.rows[0] ?? null;
  },

  async findById(id: string) {
    const result = await query(`${PRODUCT_BASE_SELECT} WHERE p.id = $1`, [id]);
    return result.rows[0] ?? null;
  },

  async related(categoryId: string, excludeProductId: string, limit = 8) {
    const result = await query(
      `${PRODUCT_BASE_SELECT}
       WHERE p.category_id = $1 AND p.id != $2 AND ${PUBLIC_VISIBILITY}
       ORDER BY p.created_at DESC, p.id ASC
       LIMIT $3`,
      [categoryId, excludeProductId, limit]
    );
    return result.rows;
  },

  async variantsForProduct(productId: string, activeOnly = false) {
    const result = await query(
      `SELECT v.*,
        COALESCE(
          (SELECT json_agg(json_build_object('id', pi.id, 'url', pi.url, 'isMain', pi.is_main) ORDER BY pi.is_main DESC, pi.sort_order)
           FROM product_images pi WHERE pi.variant_id = v.id),
          '[]'
        ) AS images
       FROM product_variants v
       WHERE v.product_id = $1 ${activeOnly ? `AND v.status = 'active'` : ''}
       ORDER BY v.created_at ASC, v.id ASC`,
      [productId]
    );
    return result.rows;
  },

  async create(input: Record<string, unknown>) {
    const result = await query(
      `INSERT INTO products
        (name, slug, short_description, full_description, brand_id, category_id,
         base_price, sale_price, currency, sku, barcode, stock_status, status,
         is_featured, is_new_arrival, is_offer, attributes, seo_title, seo_description)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,
               COALESCE($12,'in_stock'), COALESCE($13,'draft'),
               COALESCE($14,FALSE), COALESCE($15,FALSE), COALESCE($16,FALSE),
               COALESCE($17,'{}'::jsonb), $18, $19)
       RETURNING *`,
      [
        input.name, input.slug, input.shortDescription ?? null, input.fullDescription ?? null,
        input.brandId ?? null, input.categoryId,
        input.basePrice, input.salePrice ?? null, env.DEFAULT_CURRENCY,
        input.sku ?? null, input.barcode ?? null,
        input.stockStatus ?? null, input.status ?? null,
        input.isFeatured ?? null, input.isNewArrival ?? null, input.isOffer ?? null,
        input.attributes ? JSON.stringify(input.attributes) : null,
        input.seoTitle ?? null, input.seoDescription ?? null,
      ]
    );
    return result.rows[0];
  },

  async update(id: string, input: Record<string, unknown>) {
    return updateRow('products', id, PRODUCT_COLUMNS, input);
  },

  async updateStatus(id: string, status: string) {
    return updateRow('products', id, { status: 'status' }, { status });
  },

  async slugOwner(slug: string): Promise<string | null> {
    const result = await query<{ id: string }>('SELECT id FROM products WHERE slug = $1', [slug]);
    return result.rows[0]?.id ?? null;
  },

  async hasOrders(productId: string): Promise<boolean> {
    const r = await query('SELECT 1 FROM order_items WHERE product_id = $1 LIMIT 1', [productId]);
    return (r.rowCount ?? 0) > 0;
  },

  /** Deletes the product and returns the Cloudinary ids that now need cleaning up. */
  async delete(id: string): Promise<{ publicIds: string[] } | null> {
    return withTransaction(async (client) => {
      const images = await client.query<{ cloudinary_public_id: string }>(
        'SELECT cloudinary_public_id FROM product_images WHERE product_id = $1',
        [id]
      );
      const deleted = await client.query('DELETE FROM products WHERE id = $1 RETURNING id', [id]);
      if (!deleted.rowCount) return null;
      return { publicIds: images.rows.map((r) => r.cloudinary_public_id) };
    });
  },

  /** Copies the product and its variants (stock reset to 0, SKUs cleared). Images are not copied. */
  async duplicate(id: string) {
    return withTransaction(async (client) => {
      const newSlug = `${(await client.query('SELECT slug FROM products WHERE id = $1', [id])).rows[0]?.slug ?? 'product'}-copy-${Date.now()}`;
      const result = await client.query(
        `INSERT INTO products
          (name, slug, short_description, full_description, brand_id, category_id,
           base_price, sale_price, currency, sku, barcode, stock_status, status,
           is_featured, is_new_arrival, is_offer, attributes, seo_title, seo_description)
         SELECT LEFT(name, 245) || ' (Copy)', $2, short_description, full_description, brand_id, category_id,
                base_price, sale_price, currency, NULL, NULL, 'out_of_stock', 'draft',
                FALSE, FALSE, FALSE, attributes, seo_title, seo_description
         FROM products WHERE id = $1
         RETURNING *`,
        [id, newSlug]
      );
      const copy = result.rows[0];
      if (!copy) return null;
      await client.query(
        `INSERT INTO product_variants (product_id, name, price, sale_price, stock_quantity, attributes, status)
         SELECT $2, name, price, sale_price, 0, attributes, status FROM product_variants WHERE product_id = $1`,
        [id, copy.id]
      );
      return copy;
    });
  },

  // --- images ---
  async addImage(input: {
    productId: string;
    variantId?: string | null;
    cloudinaryPublicId: string;
    url: string;
    altText?: string;
    sortOrder?: number;
    isMain?: boolean;
  }) {
    return withTransaction(async (client) => {
      const variantId = input.variantId ?? null;
      const scope = [input.productId, variantId];
      const stats = await client.query(
        `SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order, BOOL_OR(is_main) AS has_main
         FROM product_images WHERE product_id = $1 AND variant_id IS NOT DISTINCT FROM $2`,
        scope
      );
      const makeMain = !!input.isMain || !stats.rows[0].has_main;
      if (makeMain) {
        await client.query(
          'UPDATE product_images SET is_main = FALSE WHERE product_id = $1 AND variant_id IS NOT DISTINCT FROM $2',
          scope
        );
      }
      const result = await client.query(
        `INSERT INTO product_images (product_id, variant_id, cloudinary_public_id, url, alt_text, sort_order, is_main)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [
          input.productId, variantId, input.cloudinaryPublicId, input.url,
          input.altText ?? null, input.sortOrder ?? stats.rows[0].next_order, makeMain,
        ]
      );
      return result.rows[0];
    });
  },

  async updateImage(
    productId: string,
    imageId: string,
    input: { altText?: string | null; sortOrder?: number; isMain?: boolean }
  ) {
    return withTransaction(async (client) => {
      const current = await client.query(
        'SELECT * FROM product_images WHERE id = $1 AND product_id = $2 FOR UPDATE',
        [imageId, productId]
      );
      const img = current.rows[0];
      if (!img) return null;
      if (input.isMain) {
        await client.query(
          'UPDATE product_images SET is_main = FALSE WHERE product_id = $1 AND variant_id IS NOT DISTINCT FROM $2 AND id <> $3',
          [productId, img.variant_id, imageId]
        );
      }
      // The only main image cannot be un-mained; promote another one instead.
      const patch: Record<string, unknown> = { altText: input.altText, sortOrder: input.sortOrder, isMain: input.isMain };
      if (input.isMain === false && img.is_main) delete patch.isMain;
      const row = await updateRowNoTimestamp(client, imageId, patch);
      return row;
    });
  },

  async findImage(productId: string, imageId: string) {
    const result = await query('SELECT * FROM product_images WHERE id = $1 AND product_id = $2', [imageId, productId]);
    return result.rows[0] ?? null;
  },

  async deleteImage(productId: string, imageId: string) {
    return withTransaction(async (client) => {
      const deleted = await client.query(
        'DELETE FROM product_images WHERE id = $1 AND product_id = $2 RETURNING *',
        [imageId, productId]
      );
      const img = deleted.rows[0];
      if (img?.is_main) {
        await client.query(
          `UPDATE product_images SET is_main = TRUE WHERE id = (
             SELECT id FROM product_images
             WHERE product_id = $1 AND variant_id IS NOT DISTINCT FROM $2
             ORDER BY sort_order, created_at LIMIT 1)`,
          [productId, img.variant_id]
        );
      }
      return img ?? null;
    });
  },

  // --- variants ---
  async createVariant(productId: string, input: Record<string, unknown>, adminId: string) {
    return withTransaction(async (client) => {
      const stock = Number(input.stockQuantity ?? 0);
      const result = await client.query(
        `INSERT INTO product_variants
          (product_id, name, sku, barcode, price, sale_price, stock_quantity, attributes, image_url, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8,'{}'::jsonb),$9,COALESCE($10,'active'))
         RETURNING *`,
        [
          productId, input.name, input.sku ?? null, input.barcode ?? null,
          input.price ?? null, input.salePrice ?? null, stock,
          input.attributes ? JSON.stringify(input.attributes) : null,
          input.imageUrl ?? null, input.status ?? null,
        ]
      );
      const variant = result.rows[0];
      if (stock > 0) {
        await client.query(
          `INSERT INTO inventory_movements
            (product_id, variant_id, previous_quantity, new_quantity, change_quantity, reason, admin_id)
           VALUES ($1,$2,0,$3,$3,'initial_stock',$4)`,
          [productId, variant.id, stock, adminId]
        );
      }
      await syncProductStockStatus(client, productId);
      return variant;
    });
  },

  async updateVariant(productId: string, variantId: string, input: Record<string, unknown>) {
    return withTransaction(async (client) => {
      const owned = await client.query('SELECT id FROM product_variants WHERE id = $1 AND product_id = $2', [variantId, productId]);
      if (!owned.rowCount) return null;
      const row = await updateRow('product_variants', variantId, VARIANT_COLUMNS, input, client);
      await syncProductStockStatus(client, productId);
      return row;
    });
  },

  async findVariant(productId: string, variantId: string) {
    const result = await query('SELECT * FROM product_variants WHERE id = $1 AND product_id = $2', [variantId, productId]);
    return result.rows[0] ?? null;
  },

  async deleteVariant(productId: string, variantId: string) {
    return withTransaction(async (client) => {
      const deleted = await client.query(
        'DELETE FROM product_variants WHERE id = $1 AND product_id = $2 RETURNING id',
        [variantId, productId]
      );
      await syncProductStockStatus(client, productId);
      return deleted.rows[0] ?? null;
    });
  },
};

/** product_images has no updated_at column. */
async function updateRowNoTimestamp(client: PoolClient, id: string, patch: Record<string, unknown>) {
  const spec: Record<string, string> = { altText: 'alt_text', sortOrder: 'sort_order', isMain: 'is_main' };
  const sets: string[] = [];
  const values: unknown[] = [id];
  for (const [key, column] of Object.entries(spec)) {
    if (patch[key] === undefined) continue;
    values.push(patch[key]);
    sets.push(`${column} = $${values.length}`);
  }
  if (!sets.length) return (await client.query('SELECT * FROM product_images WHERE id = $1', [id])).rows[0] ?? null;
  const result = await client.query(`UPDATE product_images SET ${sets.join(', ')} WHERE id = $1 RETURNING *`, values);
  return result.rows[0] ?? null;
}
