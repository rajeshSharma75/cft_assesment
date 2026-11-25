import jwt, { SignOptions } from 'jsonwebtoken';
import { env } from '../config/env';
import { unauthorized } from './app-error';

export interface TokenPayload {
  sub: string;
  email: string;
}

export interface AuthenticatedUser {
  id: string;
  email: string;
}

export function signUserToken(user: AuthenticatedUser): string {
  const options: SignOptions = {
    expiresIn: env.JWT_EXPIRES_IN as SignOptions['expiresIn'],
    issuer: 'chat-backend',
    subject: user.id,
  };

  return jwt.sign({ email: user.email }, env.JWT_SECRET, options);
}

export function verifyUserToken(token: string): AuthenticatedUser {
  try {
    const decoded = jwt.verify(token, env.JWT_SECRET, { issuer: 'chat-backend' });

    if (typeof decoded === 'string' || typeof decoded.sub !== 'string') {
      throw unauthorized('Invalid authentication token');
    }

    const email = typeof decoded.email === 'string' ? decoded.email : '';

    return { id: decoded.sub, email };
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      throw unauthorized('Authentication token has expired');
    }
    throw unauthorized('Invalid authentication token');
  }
}
