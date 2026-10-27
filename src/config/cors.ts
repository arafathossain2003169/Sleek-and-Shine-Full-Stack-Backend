import { CorsOptions } from 'cors';
import { env } from './env';
import { ForbiddenError } from '../utils/errors';

export const allowedOrigins = env.FRONTEND_URL.split(',')
  .map((o) => o.trim().replace(/\/$/, ''))
  .filter(Boolean);

export const corsOptions: CorsOptions = {
  origin(origin, callback) {
    // Non-browser tools (curl/Postman/server-side fetch) send no Origin header.
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
      return;
    }
    callback(new ForbiddenError(`Origin ${origin} is not allowed by CORS`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  maxAge: 600,
};
