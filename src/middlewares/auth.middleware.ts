import { NextFunction, Request, Response } from 'express';
import { unauthorized } from '../utils/app-error';
import { AuthenticatedUser, verifyUserToken } from '../utils/jwt';

/**
 * Verifies the `Authorization: Bearer <token>` header and attaches the
 * authenticated user to the request. Handlers must treat `req.user` as the only
 * trustworthy source of identity.
 */
export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;

  if (!header || !header.startsWith('Bearer ')) {
    next(unauthorized('Missing or malformed Authorization header'));
    return;
  }

  const token = header.slice('Bearer '.length).trim();
  if (!token) {
    next(unauthorized('Missing authentication token'));
    return;
  }

  try {
    const user: AuthenticatedUser = verifyUserToken(token);
    req.user = user;
    next();
  } catch (error) {
    next(error);
  }
}
