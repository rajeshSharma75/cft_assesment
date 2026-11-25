import type { AuthenticatedUser } from '../utils/jwt';

declare global {
  namespace Express {
    interface Request {
      /** Set by the authentication middleware after verifying the JWT. */
      user?: AuthenticatedUser;
    }
  }
}

export {};
