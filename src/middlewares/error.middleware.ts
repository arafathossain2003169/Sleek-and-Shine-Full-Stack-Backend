import { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import { ZodError } from 'zod';
import { AppError } from '../utils/errors';
import { env } from '../config/env';

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    success: false,
    message: `Route not found: ${req.method} ${req.originalUrl}`,
    errors: [],
  });
}

interface PgLikeError {
  code?: string;
  constraint?: string;
  detail?: string;
  message?: string;
}

interface HttpLikeError {
  type?: string;
  status?: number;
  statusCode?: number;
}

function send(res: Response, status: number, message: string, errors: unknown[] = []): void {
  res.status(status).json({ success: false, message, errors });
}

/** Maps well-known infrastructure errors (body-parser, multer, Postgres) to proper 4xx codes. */
function mapKnownError(err: unknown, res: Response): boolean {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') send(res, 413, 'File is too large (max 8MB)');
    else send(res, 400, `Upload error: ${err.message}`);
    return true;
  }

  const http = err as HttpLikeError;
  if (http?.type === 'entity.parse.failed') {
    send(res, 400, 'Request body is not valid JSON');
    return true;
  }
  if (http?.type === 'entity.too.large') {
    send(res, 413, 'Request body is too large');
    return true;
  }

  const pg = err as PgLikeError;
  switch (pg?.code) {
    case '23505': {
      const c = pg.constraint ?? '';
      const what = /sku/.test(c) ? 'SKU' : /slug/.test(c) ? 'slug' : /email/.test(c) ? 'email' : /code/.test(c) ? 'code' : null;
      send(res, 409, what ? `This ${what} is already in use` : 'A record with the same unique value already exists');
      return true;
    }
    case '23503':
      if (pg.message?.includes('update or delete')) {
        send(res, 409, 'This record is still referenced by other data and cannot be removed');
      } else {
        send(res, 400, 'A referenced record does not exist');
      }
      return true;
    case '22P02':
      send(res, 400, 'Invalid identifier or value format');
      return true;
    case '22003':
      send(res, 400, 'A numeric value is out of range');
      return true;
    case '23514':
    case '23502':
      send(res, 400, 'A value violates a data constraint');
      return true;
    case '40P01':
    case '40001':
      res.setHeader('Retry-After', '1');
      send(res, 503, 'The server is busy, please retry');
      return true;
    default:
      return false;
  }
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, next: NextFunction): void {
  if (res.headersSent) {
    next(err);
    return;
  }

  if (err instanceof ZodError) {
    send(
      res,
      400,
      'Validation failed',
      err.issues.map((e) => ({ path: e.path.join('.'), message: e.message }))
    );
    return;
  }

  if (err instanceof AppError) {
    send(res, err.status, err.message, err.errors);
    return;
  }

  if (mapKnownError(err, res)) return;

  // eslint-disable-next-line no-console
  console.error('Unhandled error:', err);

  const showDetails = env.IS_DEV && err instanceof Error;
  res.status(500).json({
    success: false,
    message: showDetails ? (err as Error).message : 'Internal server error',
    errors: showDetails ? [{ stack: (err as Error).stack }] : [],
  });
}
