export type ErrorCode =
  | 'BAD_REQUEST'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'VALIDATION_ERROR'
  | 'INTERNAL_ERROR'
  | 'SERVICE_UNAVAILABLE';

/**
 * Error type understood by the global error middleware. Anything else that
 * escapes a handler is treated as an unexpected 500 and is never echoed back.
 */
export class AppError extends Error {
  readonly statusCode: number;
  readonly code: ErrorCode;
  readonly details?: unknown;

  constructor(statusCode: number, message: string, code: ErrorCode, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    if (details !== undefined) this.details = details;
    Error.captureStackTrace?.(this, AppError);
  }
}

export const badRequest = (message: string, details?: unknown): AppError =>
  new AppError(400, message, 'BAD_REQUEST', details);

export const unauthorized = (message = 'Authentication is required'): AppError =>
  new AppError(401, message, 'UNAUTHORIZED');

export const forbidden = (message = 'You are not allowed to perform this action'): AppError =>
  new AppError(403, message, 'FORBIDDEN');

export const notFound = (message = 'Resource not found'): AppError =>
  new AppError(404, message, 'NOT_FOUND');

export const conflict = (message: string): AppError => new AppError(409, message, 'CONFLICT');

export const validationError = (message: string, details?: unknown): AppError =>
  new AppError(422, message, 'VALIDATION_ERROR', details);

export const serviceUnavailable = (message: string): AppError =>
  new AppError(503, message, 'SERVICE_UNAVAILABLE');
