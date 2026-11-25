import { Request, Response } from 'express';
import { asyncHandler } from '../../utils/async-handler';
import { sendSuccess } from '../../utils/api-response';
import { getAuthUser } from '../../utils/request-user';
import { ListMessagesQuery, SendMessageInput } from '../../validators/message.validator';
import { MessageService } from './message.service';

export function createMessageController(service: MessageService) {
  return {
    send: asyncHandler(async (req: Request, res: Response) => {
      const actor = getAuthUser(req);
      const body = req.body as SendMessageInput;
      const idempotencyKey =
        body.idempotencyKey ??
        (typeof req.header('Idempotency-Key') === 'string' ? req.header('Idempotency-Key') : undefined);

      const message = await service.sendMessage(
        req.params.chatId as string,
        {
          senderId: body.senderId,
          text: body.text,
          ...(idempotencyKey ? { idempotencyKey: idempotencyKey.slice(0, 128) } : {}),
        },
        actor.id,
      );
      sendSuccess(res, message, 201);
    }),

    list: asyncHandler(async (req: Request, res: Response) => {
      const actor = getAuthUser(req);
      const query = req.query as unknown as ListMessagesQuery;
      const page = await service.listMessages(req.params.chatId as string, actor.id, {
        limit: query.limit,
        cursor: query.cursor,
      });
      sendSuccess(res, page);
    }),

    markRead: asyncHandler(async (req: Request, res: Response) => {
      const actor = getAuthUser(req);
      const body = req.body as { userId: string };
      const receipt = await service.markMessageRead(
        req.params.chatId as string,
        req.params.messageId as string,
        body.userId,
        actor.id,
      );
      sendSuccess(res, receipt);
    }),

    updateLastSeen: asyncHandler(async (req: Request, res: Response) => {
      const actor = getAuthUser(req);
      const body = req.body as { userId: string; messageId: string };
      const result = await service.updateLastSeen(
        req.params.chatId as string,
        body.userId,
        body.messageId,
        actor.id,
      );
      sendSuccess(res, result);
    }),

    edit: asyncHandler(async (req: Request, res: Response) => {
      const actor = getAuthUser(req);
      const body = req.body as { text: string };
      const message = await service.editMessage(
        req.params.chatId as string,
        req.params.messageId as string,
        body.text,
        actor.id,
      );
      sendSuccess(res, message);
    }),

    remove: asyncHandler(async (req: Request, res: Response) => {
      const actor = getAuthUser(req);
      const message = await service.deleteMessage(
        req.params.chatId as string,
        req.params.messageId as string,
        actor.id,
      );
      sendSuccess(res, message);
    }),
  };
}
