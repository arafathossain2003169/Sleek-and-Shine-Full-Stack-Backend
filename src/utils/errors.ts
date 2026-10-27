export class AppError extends Error {
  public status: number;
  public errors: unknown[];

  constructor(message: string, status = 500, errors: unknown[] = []) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.errors = errors;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class BadRequestError extends AppError {
  constructor(message = 'Bad request', errors: unknown[] = []) {
    super(message, 400, errors);
    this.name = 'BadRequestError';
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized') {
    super(message, 401);
    this.name = 'UnauthorizedError';
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden') {
    super(message, 403);
    this.name = 'ForbiddenError';
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Resource not found') {
    super(message, 404);
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Conflict', errors: unknown[] = []) {
    super(message, 409, errors);
    this.name = 'ConflictError';
  }
}

export class UnprocessableEntityError extends AppError {
  constructor(message = 'Unprocessable entity', errors: unknown[] = []) {
    super(message, 422, errors);
    this.name = 'UnprocessableEntityError';
  }
}

export class TooManyRequestsError extends AppError {
  constructor(message = 'Too many requests', public retryAfterSeconds?: number) {
    super(message, 429, retryAfterSeconds ? [{ retryAfterSeconds }] : []);
    this.name = 'TooManyRequestsError';
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(message = 'Service temporarily unavailable') {
    super(message, 503, []);
    this.name = 'ServiceUnavailableError';
  }
}
