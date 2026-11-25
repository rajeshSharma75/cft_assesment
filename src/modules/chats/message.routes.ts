import { Router } from 'express';
import { validate } from '../../middlewares/validate.middleware';
import {
  deleteMessageSchema,
  editMessageSchema,
  listMessagesSchema,
  markMessageReadSchema,
  sendMessageSchema,
  updateLastSeenSchema,
} from '../../validators/message.validator';
import { createMessageController } from './message.controller';
import { MessageService } from './message.service';

export function createMessageRouter(service: MessageService): Router {
  const router = Router();
  const controller = createMessageController(service);

  router.post('/:chatId/message/send', validate(sendMessageSchema), controller.send);
  router.get('/:chatId/messages', validate(listMessagesSchema), controller.list);
  router.post(
    '/:chatId/message/:messageId/read',
    validate(markMessageReadSchema),
    controller.markRead,
  );
  router.post('/:chatId/lastseen', validate(updateLastSeenSchema), controller.updateLastSeen);
  router.patch('/:chatId/message/:messageId', validate(editMessageSchema), controller.edit);
  router.delete('/:chatId/message/:messageId', validate(deleteMessageSchema), controller.remove);

  return router;
}
