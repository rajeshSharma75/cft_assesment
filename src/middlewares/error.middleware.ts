import { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../utils/app-error';
import { sendError } from '../utils/api-response';

export function notFoundHandler(req: Request, res: Response): void {
  sendError(res, 404, `Route ${req.method} ${req.path} not found`, 'NOT_FOUND');
}

interface BodyParserError extends Error {
  type?: string;
}

export function errorHandler(
  error: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (res.headersSent) return;

  if (error instanceof AppError) {
    if (error.statusCode >= 500) {
      console.error(`[error] ${req.method} ${req.path} -> ${error.code}: ${error.message}`);
    }
    sendError(res, error.statusCode, error.message, error.code, error.details);
    return;
  }

  if (error instanceof ZodError) {
    sendError(
      res,
      422,
      'Request validation failed',
      'VALIDATION_ERROR',
      error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    );
    return;
  }

  if (error instanceof SyntaxError) {
    const maybeBodyError = error as BodyParserError;
    if (maybeBodyError.type === 'entity.parse.failed') {
      sendError(res, 400, 'Request body is not valid JSON', 'BAD_REQUEST');
      return;
    }
  }

  // Unknown errors: log server-side only, never leak internals to the client.
  console.error(`[error] ${req.method} ${req.path} -> unhandled error`, error);
  sendError(res, 500, 'Internal server error', 'INTERNAL_ERROR');
}
