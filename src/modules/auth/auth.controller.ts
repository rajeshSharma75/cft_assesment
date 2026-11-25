import { Request, Response } from 'express';
import { asyncHandler } from '../../utils/async-handler';
import { sendSuccess } from '../../utils/api-response';
import { getAuthUser } from '../../utils/request-user';
import { DevTokenInput } from '../../validators/auth.validator';
import { AuthService } from './auth.service';

export function createAuthController(service: AuthService) {
  return {
    devToken: asyncHandler(async (req: Request, res: Response) => {
      const body = req.body as DevTokenInput;
      const result = await service.issueDevToken(body.email);
      sendSuccess(res, result);
    }),

    me: asyncHandler(async (req: Request, res: Response) => {
      const user = getAuthUser(req);
      sendSuccess(res, { id: user.id, email: user.email });
    }),
  };
}
