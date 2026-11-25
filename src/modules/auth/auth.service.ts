import { env, isProduction } from '../../config/env';
import { forbidden, notFound } from '../../utils/app-error';
import { signUserToken } from '../../utils/jwt';
import { UserRepository, userRepository } from '../users/user.repository';

export interface DevTokenResult {
  token: string;
  tokenType: 'Bearer';
  expiresIn: string;
  user: { id: string; name: string; email: string };
}

/**
 * Development-only token issuing. The assessment does not require registration
 * or passwords, so seeded users can obtain a JWT by email in non-production
 * environments.
 */
export class AuthService {
  constructor(private readonly users: UserRepository = userRepository) {}

  async issueDevToken(email: string): Promise<DevTokenResult> {
    if (isProduction) {
      throw forbidden('Development token generation is disabled in production');
    }

    const user = await this.users.findByEmail(email);
    if (!user) {
      throw notFound('No user found with that email address');
    }

    return {
      token: signUserToken({ id: user.id, email: user.email }),
      tokenType: 'Bearer',
      expiresIn: env.JWT_EXPIRES_IN,
      user: { id: user.id, name: user.name, email: user.email },
    };
  }
}

export const authService = new AuthService();
