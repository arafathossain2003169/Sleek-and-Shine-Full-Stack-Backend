import { Router } from 'express';
import { requireAuth } from '../../middlewares/auth.middleware';
import {
  ADMIN_ROLES,
  CATALOG_WRITE_ROLES,
  INVENTORY_WRITE_ROLES,
  ORDER_ROLES,
  SETTINGS_ROLES,
  STAFF_MANAGER_ROLES,
  requireAdmin,
  requireRole,
  requireRoleByMethod,
} from '../../middlewares/role.middleware';

import dashboardRoutes from './dashboard/dashboard.routes';
import productsAdminRoutes from './products/products.admin.routes';
import attributesRoutes from './attributes/attributes.routes';
import categoriesAdminRoutes from './categories/categories.admin.routes';
import brandsAdminRoutes from './brands/brands.admin.routes';
import inventoryAdminRoutes from './inventory/inventory.admin.routes';
import ordersAdminRoutes from './orders/orders.admin.routes';
import customersAdminRoutes from './customers/customers.admin.routes';
import couponsAdminRoutes from './coupons/coupons.admin.routes';
import contentAdminRoutes from './content/content.admin.routes';
import auditLogsRoutes from './audit/audit.admin.routes';
import staffAdminRoutes from './staff/staff.admin.routes';
import settingsAdminRoutes from './settings/settings.admin.routes';

const router = Router();

// Authentication + at least one admin-tier role for everything below.
router.use(requireAuth, requireAdmin);

/*
 * Permission matrix (read = GET, write = everything else)
 *   catalogue (products/categories/brands/attributes): read all staff, write admin|manager|super_admin
 *   inventory: read all staff, adjust stock admin|manager|inventory_staff|super_admin
 *   orders & customers: admin|manager|order_manager|super_admin (customer status: no order_manager)
 *   coupons, content, audit logs: admin|manager|super_admin
 *   staff accounts + settings: admin|super_admin (only a super_admin can grant/revoke super_admin)
 */
router.use('/dashboard', dashboardRoutes);
router.use('/products', requireRoleByMethod(ADMIN_ROLES, CATALOG_WRITE_ROLES), productsAdminRoutes);
router.use('/attributes', requireRoleByMethod(ADMIN_ROLES, CATALOG_WRITE_ROLES), attributesRoutes);
router.use('/categories', requireRoleByMethod(ADMIN_ROLES, CATALOG_WRITE_ROLES), categoriesAdminRoutes);
router.use('/brands', requireRoleByMethod(ADMIN_ROLES, CATALOG_WRITE_ROLES), brandsAdminRoutes);
router.use('/inventory', requireRoleByMethod(ADMIN_ROLES, INVENTORY_WRITE_ROLES), inventoryAdminRoutes);
router.use('/orders', requireRole(...ORDER_ROLES), ordersAdminRoutes);
router.use('/customers', requireRoleByMethod(ORDER_ROLES, CATALOG_WRITE_ROLES), customersAdminRoutes);
router.use('/coupons', requireRole(...CATALOG_WRITE_ROLES), couponsAdminRoutes);

// Homepage content: `/content` and the documented `/content/homepage` alias both work.
router.use('/content', requireRole(...CATALOG_WRITE_ROLES), contentAdminRoutes);

router.use('/audit-logs', requireRole(...CATALOG_WRITE_ROLES), auditLogsRoutes);
router.use('/staff', requireRole(...STAFF_MANAGER_ROLES), staffAdminRoutes);
router.use('/settings', requireRole(...SETTINGS_ROLES), settingsAdminRoutes);

export default router;
