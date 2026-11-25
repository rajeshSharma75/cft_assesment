import { Router } from 'express';
import { authenticate } from '../../middlewares/auth.middleware';
import { validate } from '../../middlewares/validate.middleware';
import { devTokenSchema } from '../../validators/auth.validator';
import { createAuthController } from './auth.controller';
import { AuthService } from './auth.service';

export function createAuthRouter(service: AuthService): Router {
  const router = Router();
  const controller = createAuthController(service);

  router.post('/dev-token', validate(devTokenSchema), controller.devToken);
  router.get('/me', authenticate, controller.me);

  return router;
}
