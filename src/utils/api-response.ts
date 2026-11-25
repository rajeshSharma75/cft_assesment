import { Response } from 'express';

export interface ApiSuccessBody<T> {
  success: true;
  data: T;
}

export interface ApiFailureBody {
  success: false;
  message: string;
  code: string;
  details?: unknown;
}

export function sendSuccess<T>(res: Response, data: T, statusCode = 200): Response {
  const body: ApiSuccessBody<T> = { success: true, data };
  return res.status(statusCode).json(body);
}

export function sendError(
  res: Response,
  statusCode: number,
  message: string,
  code: string,
  details?: unknown,
): Response {
  const body: ApiFailureBody = { success: false, message, code };
  if (details !== undefined) body.details = details;
  return res.status(statusCode).json(body);
}
