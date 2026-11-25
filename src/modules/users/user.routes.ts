import { Router } from 'express';
import { authenticate } from '../../middlewares/auth.middleware';
import { validate } from '../../middlewares/validate.middleware';
import { z } from 'zod';
import { createUserController } from './user.controller';
import { UserService } from './user.service';

export function createUserRouter(service: UserService): Router {
  const router = Router();
  const controller = createUserController(service);

  router.use(authenticate);

  router.get('/', controller.list);
  router.get(
    '/:userId',
    validate({ params: z.object({ userId: z.string().uuid() }) }),
    controller.getById,
  );

  return router;
}
