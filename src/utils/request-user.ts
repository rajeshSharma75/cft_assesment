import { Request } from 'express';
import { unauthorized } from './app-error';
import { AuthenticatedUser } from './jwt';

/**
 * Narrows `req.user` for handlers mounted behind the auth middleware.
 * Throws rather than trusting any user ID supplied by the client.
 */
export function getAuthUser(req: Request): AuthenticatedUser {
  if (!req.user) throw unauthorized();
  return req.user;
}
