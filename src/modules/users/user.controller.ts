import { Request, Response } from 'express';
import { asyncHandler } from '../../utils/async-handler';
import { sendSuccess } from '../../utils/api-response';
import { getAuthUser } from '../../utils/request-user';
import { UserService } from './user.service';

export function createUserController(service: UserService) {
  return {
    list: asyncHandler(async (_req: Request, res: Response) => {
      const users = await service.listUsers();
      sendSuccess(res, users);
    }),

    getById: asyncHandler(async (req: Request, res: Response) => {
      const actor = getAuthUser(req);
      const user = await service.getUser(req.params.userId as string, actor.id);
      sendSuccess(res, user);
    }),
  };
}
