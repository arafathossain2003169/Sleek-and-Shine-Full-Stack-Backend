import express, { Application } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { corsOptions } from './config/cors';
import { env } from './config/env';
import crypto from 'crypto';
import { query } from './config/db';
import { csrfGuard } from './middlewares/csrf.middleware';
import { generalApiRateLimiter } from './middlewares/rateLimit.middleware';
import { errorHandler, notFoundHandler } from './middlewares/error.middleware';

import authRoutes from './modules/auth/auth.routes';
import userRoutes from './modules/users/users.routes';
import productRoutes from './modules/products/products.routes';
import categoryRoutes from './modules/categories/categories.routes';
import brandRoutes from './modules/brands/brands.routes';
import cartRoutes from './modules/cart/cart.routes';
import checkoutRoutes from './modules/checkout/checkout.routes';
import orderRoutes from './modules/orders/orders.routes';
import couponRoutes from './modules/coupons/coupons.routes';
import contentRoutes from './modules/content/content.routes';
import mediaRoutes from './modules/media/media.routes';
import searchRoutes from './modules/search/search.routes';
import adminRoutes from './modules/admin/admin.routes';

export function createApp(): Application {
  const app = express();

  app.set('trust proxy', env.TRUST_PROXY);
  app.disable('x-powered-by');

  // Request id + one-line access log (skipped in tests).
  app.use((req, res, next) => {
    const id = (req.headers['x-request-id'] as string) || crypto.randomUUID();
    res.setHeader('X-Request-Id', id);
    if (!env.IS_TEST) {
      const started = Date.now();
      res.on('finish', () => {
        // eslint-disable-next-line no-console
        console.log(`${id} ${req.method} ${req.originalUrl.split('?')[0]} ${res.statusCode} ${Date.now() - started}ms`);
      });
    }
    next();
  });

  app.use(helmet());
  app.use(cors(corsOptions));
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));
  app.use(cookieParser(env.COOKIE_SECRET));
  app.use(csrfGuard);

  // Health checks are exempt from rate limiting so load balancers never get throttled.
  app.get('/health', (_req, res) => {
    res.json({ success: true, message: 'SleeknShine API is running', data: {} });
  });
  app.get('/health/ready', async (_req, res) => {
    try {
      await query('SELECT 1');
      res.json({ success: true, message: 'Ready', data: {} });
    } catch {
      res.status(503).json({ success: false, message: 'Database unavailable', errors: [] });
    }
  });

  app.use(generalApiRateLimiter);

  app.use('/api/auth', authRoutes);
  app.use('/api/users', userRoutes);
  app.use('/api/products', productRoutes);
  app.use('/api/categories', categoryRoutes);
  app.use('/api/brands', brandRoutes);
  app.use('/api/cart', cartRoutes);
  app.use('/api/checkout', checkoutRoutes);
  app.use('/api/orders', orderRoutes);
  app.use('/api/coupons', couponRoutes);
  app.use('/api/content', contentRoutes);
  app.use('/api/media', mediaRoutes);
  app.use('/api/search', searchRoutes);
  app.use('/api/admin', adminRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
