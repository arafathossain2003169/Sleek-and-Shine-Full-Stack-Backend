import { Response } from 'express';

export interface ApiMeta {
  page?: number;
  limit?: number;
  total?: number;
  totalPages?: number;
  [key: string]: unknown;
}

export type MetaLike = ApiMeta | Record<string, unknown>;

export function sendSuccess<T>(
  res: Response,
  data: T,
  message = 'Success',
  status = 200,
  meta?: Record<string, unknown>
): Response {
  return res.status(status).json({
    success: true,
    message,
    data,
    meta: meta ?? {},
  });
}

export function sendError(
  res: Response,
  message = 'Something went wrong',
  status = 500,
  errors: unknown[] = []
): Response {
  return res.status(status).json({
    success: false,
    message,
    errors,
  });
}
