import { query } from '../../config/db';
import { BadRequestError, ConflictError, NotFoundError } from '../../utils/errors';
import { buildPaginationMeta, parsePagination } from '../../utils/pagination';
import { normalizeSalePrice, unitPriceFor } from '../../utils/pricing';
import { slugify } from '../../utils/slug';
import { getAttributeDefinitions, validateAttributes } from '../admin/attributes/attributes.validation';
import { productsRepository } from './products.repository';

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

interface VisibleAttr {
  name: string;
  type: string;
}
type VisibleAttrs = Map<string, VisibleAttr>;

async function visibleAttributeSlugs(): Promise<VisibleAttrs> {
  const defs = await getAttributeDefinitions();
  return new Map(defs.filter((d) => d.is_visible).map((d) => [d.slug, { name: d.name, type: d.type }]));
}

function filterVisible(attributes: Record<string, unknown> | null, visible: VisibleAttrs) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(attributes ?? {})) if (visible.has(k)) out[k] = v;
  return out;
}

/** Display-ready list ("Skin Type: Oily, Dry") so the storefront never has to show raw slugs. */
function attributeDetails(attributes: Record<string, unknown> | null, visible: VisibleAttrs) {
  const out: { slug: string; name: string; type: string; value: unknown }[] = [];
  for (const [slug, def] of visible) {
    const value = (attributes ?? {})[slug];
    if (value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0)) continue;
    out.push({ slug, name: def.name, type: def.type, value });
  }
  return out;
}

/** The one public product shape used by every storefront endpoint (list, search, category, brand, detail). */
export function toPublicProduct(row: Row, visible: VisibleAttrs) {
  const salePrice = normalizeSalePrice(row.base_price, row.sale_price);
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    shortDescription: row.short_description,
    fullDescription: row.full_description,
    brand: row.brand_id ? { id: row.brand_id, name: row.brand_name, slug: row.brand_slug } : null,
    category: row.category_id ? { id: row.category_id, name: row.category_name, slug: row.category_slug } : null,
    basePrice: Number(row.base_price),
    salePrice,
    finalPrice: unitPriceFor(row as never),
    currency: row.currency,
    stockStatus: row.stock_status,
    isFeatured: row.is_featured,
    isNewArrival: row.is_new_arrival,
    isOffer: row.is_offer,
    hasVariants: (row.active_variant_count ?? 0) > 0,
    attributes: filterVisible(row.attributes, visible),
    attributeDetails: attributeDetails(row.attributes, visible),
    images: row.images ?? [],
    seoTitle: row.seo_title,
    seoDescription: row.seo_description,
    createdAt: row.created_at,
  };
}

function toPublicVariant(v: Row, product: Row) {
  return {
    id: v.id,
    name: v.name,
    sku: v.sku,
    price: v.price === null ? null : Number(v.price),
    salePrice: v.sale_price === null ? null : Number(v.sale_price),
    finalPrice: unitPriceFor(product as never, v as never),
    stockQuantity: v.stock_quantity,
    attributes: v.attributes,
    imageUrl: v.image_url,
    status: v.status,
    images: v.images ?? [],
  };
}

function toAdminProduct(row: Row) {
  return {
    ...toPublicProduct(
      row,
      new Map(Object.keys(row.attributes ?? {}).map((k) => [k, { name: k, type: 'text' }]))
    ),
    totalStock: row.total_stock ?? 0,
    sku: row.sku,
    barcode: row.barcode,
    status: row.status,
    updatedAt: row.updated_at,
  };
}

async function parseAttributeFilters(raw: string | undefined) {
  if (!raw) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new BadRequestError('attributes filter must be valid JSON');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new BadRequestError('attributes filter must be a JSON object');
  }
  const filterable = new Set((await getAttributeDefinitions()).filter((d) => d.is_filterable).map((d) => d.slug));
  const unknown = Object.keys(parsed).filter((k) => !filterable.has(k));
  if (unknown.length) throw new BadRequestError(`Not filterable: ${unknown.join(', ')}`);
  return parsed as Record<string, unknown>;
}

interface ListQuery {
  page?: string;
  limit?: string;
  search?: string;
  category?: string;
  brand?: string;
  minPrice?: string;
  maxPrice?: string;
  sort?: string;
  isNewArrival?: boolean;
  isOffer?: boolean;
  isFeatured?: boolean;
  attributes?: string;
  status?: string;
}

async function assertCategoryAndBrand(categoryId?: string | null, brandId?: string | null) {
  if (categoryId) {
    const r = await query('SELECT 1 FROM categories WHERE id = $1', [categoryId]);
    if (!r.rowCount) throw new BadRequestError('Category does not exist');
  }
  if (brandId) {
    const r = await query('SELECT 1 FROM brands WHERE id = $1', [brandId]);
    if (!r.rowCount) throw new BadRequestError('Brand does not exist');
  }
}

export const productsService = {
  async listPublic(q: ListQuery) {
    const { page, limit, offset } = parsePagination(q as never);
    const { rows, total } = await productsRepository.list({
      search: q.search,
      categorySlug: q.category,
      brandSlug: q.brand,
      minPrice: q.minPrice !== undefined ? Number(q.minPrice) : undefined,
      maxPrice: q.maxPrice !== undefined ? Number(q.maxPrice) : undefined,
      sort: q.sort,
      isNewArrival: q.isNewArrival,
      isOffer: q.isOffer,
      isFeatured: q.isFeatured,
      attributes: await parseAttributeFilters(q.attributes),
      limit,
      offset,
    });
    const visible = await visibleAttributeSlugs();
    return {
      products: rows.map((r) => toPublicProduct(r, visible)),
      meta: buildPaginationMeta(page, limit, total),
    };
  },

  async getBySlug(slug: string) {
    const row = await productsRepository.findBySlug(slug, true);
    if (!row) throw new NotFoundError('Product not found');
    const [variants, visible] = await Promise.all([
      productsRepository.variantsForProduct(row.id, true),
      visibleAttributeSlugs(),
    ]);
    return {
      ...toPublicProduct(row, visible),
      variants: variants.map((v) => toPublicVariant(v, row)),
    };
  },

  async related(slug: string) {
    const row = await productsRepository.findBySlug(slug, true);
    if (!row) throw new NotFoundError('Product not found');
    const [rows, visible] = await Promise.all([
      productsRepository.related(row.category_id, row.id),
      visibleAttributeSlugs(),
    ]);
    return rows.map((r) => toPublicProduct(r, visible));
  },

  // ---------------- admin ----------------
  async adminList(q: ListQuery) {
    const { page, limit, offset } = parsePagination(q as never);
    const { rows, total } = await productsRepository.list({
      search: q.search,
      categorySlug: q.category,
      brandSlug: q.brand,
      sort: q.sort,
      statusIn: q.status ? [q.status] : ['draft', 'published', 'hidden', 'archived'],
      limit,
      offset,
    });
    return { products: rows.map(toAdminProduct), meta: buildPaginationMeta(page, limit, total) };
  },

  async adminGetById(id: string) {
    const row = await productsRepository.findById(id);
    if (!row) throw new NotFoundError('Product not found');
    const variants = await productsRepository.variantsForProduct(id);
    return {
      ...toAdminProduct(row),
      variants: variants.map((v) => ({
        ...toPublicVariant(v, row),
        barcode: v.barcode,
      })),
    };
  },

  async adminCreate(input: Row) {
    const slug = (input.slug as string | undefined) ?? slugify(input.name);
    if (slug.length < 2) throw new BadRequestError('Could not derive a valid slug from the name; please provide one');
    if (await productsRepository.slugOwner(slug)) throw new ConflictError('A product with this slug already exists');
    await assertCategoryAndBrand(input.categoryId, input.brandId);
    await validateAttributes(input.attributes, {
      scope: 'product',
      requireRequired: input.status === 'published',
    });
    const created = await productsRepository.create({ ...input, slug });
    return toAdminProduct((await productsRepository.findById(created.id)) as Row);
  },

  async adminUpdate(id: string, input: Row) {
    const existing = await productsRepository.findById(id);
    if (!existing) throw new NotFoundError('Product not found');

    if (input.slug && input.slug !== existing.slug) {
      const owner = await productsRepository.slugOwner(input.slug);
      if (owner && owner !== id) throw new ConflictError('A product with this slug already exists');
    }
    await assertCategoryAndBrand(input.categoryId, input.brandId);

    const base = input.basePrice ?? Number(existing.base_price);
    const sale = input.salePrice !== undefined ? input.salePrice : existing.sale_price;
    if (sale !== null && sale !== undefined && Number(sale) >= Number(base)) {
      throw new BadRequestError('Sale price must be lower than the regular price');
    }

    const finalStatus = input.status ?? existing.status;
    if (input.attributes !== undefined || (input.status === 'published' && existing.status !== 'published')) {
      await validateAttributes(input.attributes ?? existing.attributes, {
        scope: 'product',
        requireRequired: finalStatus === 'published',
      });
    }

    await productsRepository.update(id, input);
    return {
      before: toAdminProduct(existing),
      after: toAdminProduct((await productsRepository.findById(id)) as Row),
    };
  },

  async adminUpdateStatus(id: string, status: string) {
    const existing = await productsRepository.findById(id);
    if (!existing) throw new NotFoundError('Product not found');
    if (status === 'published') {
      await validateAttributes(existing.attributes, { scope: 'product', requireRequired: true });
    }
    await productsRepository.updateStatus(id, status);
    return toAdminProduct((await productsRepository.findById(id)) as Row);
  },

  /** Returns the Cloudinary ids to clean up. Products with order history must be archived instead. */
  async adminDelete(id: string) {
    const existing = await productsRepository.findById(id);
    if (!existing) throw new NotFoundError('Product not found');
    if (await productsRepository.hasOrders(id)) {
      throw new ConflictError(
        'This product appears in existing orders and cannot be deleted. Archive it instead to hide it from the store.'
      );
    }
    const result = await productsRepository.delete(id);
    return { product: toAdminProduct(existing), publicIds: result?.publicIds ?? [] };
  },

  async adminDuplicate(id: string) {
    const copy = await productsRepository.duplicate(id);
    if (!copy) throw new NotFoundError('Product not found');
    return toAdminProduct((await productsRepository.findById(copy.id)) as Row);
  },

  async ensureExists(id: string) {
    const row = await productsRepository.findById(id);
    if (!row) throw new NotFoundError('Product not found');
    return row;
  },

  async adminAddImage(
    productId: string,
    uploaded: { publicId: string; url: string },
    meta: { altText?: string; sortOrder?: number; isMain?: boolean; variantId?: string }
  ) {
    if (meta.variantId && !(await productsRepository.findVariant(productId, meta.variantId))) {
      throw new BadRequestError('Variant does not belong to this product');
    }
    return productsRepository.addImage({
      productId,
      variantId: meta.variantId,
      cloudinaryPublicId: uploaded.publicId,
      url: uploaded.url,
      altText: meta.altText,
      sortOrder: meta.sortOrder,
      isMain: meta.isMain,
    });
  },

  async adminUpdateImage(productId: string, imageId: string, input: Row) {
    const image = await productsRepository.updateImage(productId, imageId, input);
    if (!image) throw new NotFoundError('Image not found');
    return image;
  },

  async adminDeleteImage(productId: string, imageId: string) {
    const image = await productsRepository.deleteImage(productId, imageId);
    if (!image) throw new NotFoundError('Image not found');
    return image;
  },

  async adminCreateVariant(productId: string, input: Row, adminId: string) {
    await this.ensureExists(productId);
    await validateAttributes(input.attributes, { scope: 'variant', requireRequired: false });
    return productsRepository.createVariant(productId, input, adminId);
  },

  async adminUpdateVariant(productId: string, variantId: string, input: Row) {
    const existing = await productsRepository.findVariant(productId, variantId);
    if (!existing) throw new NotFoundError('Variant not found');
    const price = input.price !== undefined ? input.price : existing.price;
    const sale = input.salePrice !== undefined ? input.salePrice : existing.sale_price;
    if (price != null && sale != null && Number(sale) >= Number(price)) {
      throw new BadRequestError('Sale price must be lower than the price');
    }
    if (input.attributes !== undefined) {
      await validateAttributes(input.attributes, { scope: 'variant', requireRequired: false });
    }
    const updated = await productsRepository.updateVariant(productId, variantId, input);
    return { before: existing, after: updated };
  },

  async adminDeleteVariant(productId: string, variantId: string) {
    const existing = await productsRepository.findVariant(productId, variantId);
    if (!existing) throw new NotFoundError('Variant not found');
    await productsRepository.deleteVariant(productId, variantId);
    return existing;
  },
};
