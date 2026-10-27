/* eslint-disable no-console */
import { pool } from '../config/db';
import crypto from 'crypto';
import { env } from '../config/env';
import { hashPassword } from '../utils/password';
import { slugify } from '../utils/slug';
import {
  SEED_ADMIN,
  SEED_BRANDS,
  SEED_CATEGORIES,
  SEED_ATTRIBUTES,
  SEED_PRODUCTS,
  SEED_HOMEPAGE_SECTIONS,
} from './seeds/seedData';

async function seedAdmin(): Promise<void> {
  const existing = await pool.query('SELECT id FROM users WHERE email = $1', [
    SEED_ADMIN.email,
  ]);
  if (existing.rowCount) {
    console.log('Admin user already exists, skipping.');
    return;
  }
  // Never ship a well-known default: use SEED_ADMIN_PASSWORD, or generate a random one (shown once).
  const provided = process.env.SEED_ADMIN_PASSWORD;
  if (env.IS_PROD && !provided) {
    throw new Error('Set SEED_ADMIN_PASSWORD when seeding a production database');
  }
  const password = provided ?? `Adm-${crypto.randomBytes(9).toString('base64url')}9`;
  const passwordHash = await hashPassword(password);
  await pool.query(
    `INSERT INTO users (name, email, password_hash, role, email_verified, status)
     VALUES ($1, $2, $3, $4, TRUE, 'active')`,
    [SEED_ADMIN.name, SEED_ADMIN.email, passwordHash, SEED_ADMIN.role]
  );
  console.log(`Seeded admin user: ${SEED_ADMIN.email}`);
  if (!provided) console.log(`Generated admin password (shown once, store it now): ${password}`);
}

async function seedCategories(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (let i = 0; i < SEED_CATEGORIES.length; i += 1) {
    const cat = SEED_CATEGORIES[i];
    const slug = slugify(cat.name);
    const result = await pool.query<{ id: string }>(
      `INSERT INTO categories (name, slug, description, sort_order, is_active)
       VALUES ($1, $2, $3, $4, TRUE)
       ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [cat.name, slug, cat.description, i]
    );
    map.set(cat.name, result.rows[0].id);
  }
  console.log(`Seeded ${SEED_CATEGORIES.length} categories.`);
  return map;
}

async function seedBrands(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (const brand of SEED_BRANDS) {
    const slug = slugify(brand.name);
    const result = await pool.query<{ id: string }>(
      `INSERT INTO brands (name, slug, description, is_active)
       VALUES ($1, $2, $3, TRUE)
       ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [brand.name, slug, brand.description]
    );
    map.set(brand.name, result.rows[0].id);
  }
  console.log(`Seeded ${SEED_BRANDS.length} brands.`);
  return map;
}

async function seedAttributes(): Promise<void> {
  for (let i = 0; i < SEED_ATTRIBUTES.length; i += 1) {
    const attr = SEED_ATTRIBUTES[i];
    const slug = slugify(attr.name);
    await pool.query(
      `INSERT INTO attribute_definitions
        (name, slug, type, predefined_values, is_required, is_filterable, is_visible, applies_to, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (slug) DO UPDATE SET type = EXCLUDED.type`,
      [
        attr.name,
        slug,
        attr.type,
        JSON.stringify(attr.predefined_values),
        attr.is_required,
        attr.is_filterable,
        attr.is_visible,
        attr.applies_to,
        i,
      ]
    );
  }
  console.log(`Seeded ${SEED_ATTRIBUTES.length} attribute definitions.`);
}

async function seedProducts(
  categoryMap: Map<string, string>,
  brandMap: Map<string, string>
): Promise<void> {
  let count = 0;
  for (const p of SEED_PRODUCTS) {
    const slug = slugify(p.name);
    const categoryId = categoryMap.get(p.categoryName);
    const brandId = p.brandName ? brandMap.get(p.brandName) ?? null : null;
    if (!categoryId) continue;

    const result = await pool.query<{ id: string }>(
      `INSERT INTO products
        (name, slug, short_description, full_description, brand_id, category_id,
         base_price, sale_price, currency, stock_status, status,
         is_featured, is_new_arrival, is_offer)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'USD','in_stock','published',$9,$10,$11)
       ON CONFLICT (slug) DO UPDATE SET base_price = EXCLUDED.base_price
       RETURNING id`,
      [
        p.name,
        slug,
        p.shortDescription,
        p.fullDescription,
        brandId,
        categoryId,
        p.basePrice,
        p.salePrice,
        p.isFeatured,
        p.isNewArrival,
        p.isOffer,
      ]
    );

    const productId = result.rows[0].id;

    // Ensure at least one default variant exists for stock tracking demo purposes
    const variantExists = await pool.query(
      'SELECT id FROM product_variants WHERE product_id = $1 LIMIT 1',
      [productId]
    );
    if (!variantExists.rowCount) {
      await pool.query(
        `INSERT INTO product_variants (product_id, name, stock_quantity, status)
         VALUES ($1, 'Default', $2, 'active')`,
        [productId, Math.floor(Math.random() * 80) + 20]
      );
    }

    count += 1;
  }
  console.log(`Seeded ${count} products.`);
}

async function seedHomepageSections(): Promise<void> {
  const existing = await pool.query('SELECT COUNT(*)::int AS count FROM homepage_sections');
  if (existing.rows[0].count > 0) {
    console.log('Homepage sections already seeded, skipping.');
    return;
  }
  for (const section of SEED_HOMEPAGE_SECTIONS) {
    await pool.query(
      `INSERT INTO homepage_sections (type, title, subtitle, button_text, button_link, sort_order, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,TRUE)`,
      [
        section.type,
        section.title,
        section.subtitle ?? null,
        (section as { button_text?: string }).button_text ?? null,
        (section as { button_link?: string }).button_link ?? null,
        section.sort_order,
      ]
    );
  }
  console.log(`Seeded ${SEED_HOMEPAGE_SECTIONS.length} homepage sections.`);
}

async function main(): Promise<void> {
  console.log('Starting database seed...');
  await seedAdmin();
  const categoryMap = await seedCategories();
  const brandMap = await seedBrands();
  await seedAttributes();
  await seedProducts(categoryMap, brandMap);
  await seedHomepageSections();
  console.log('Seed complete.');
}

main()
  .then(() => pool.end())
  .catch((err) => {
    console.error('Seed failed:', err);
    pool.end().finally(() => process.exit(1));
  });
