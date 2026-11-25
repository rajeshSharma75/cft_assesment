import { Router } from 'express';
import { validate } from '../../middlewares/validate.middleware';
import {
  addMembersSchema,
  chatIdParamsSchema,
  createDirectChatSchema,
  createGroupChatSchema,
  listUserChatsSchema,
  removeMemberSchema,
} from '../../validators/chat.validator';
import { createChatController } from './chat.controller';
import { ChatService } from './chat.service';

export function createChatRouter(service: ChatService): Router {
  const router = Router();
  const controller = createChatController(service);

  router.post('/create', validate(createDirectChatSchema), controller.createDirectChat);
  router.post('/group/create', validate(createGroupChatSchema), controller.createGroupChat);

  router.get('/:chatId/members', validate(chatIdParamsSchema), controller.listMembers);
  router.post('/:chatId/members', validate(addMembersSchema), controller.addMembers);
  router.delete('/:chatId/members/:userId', validate(removeMemberSchema), controller.removeMember);

  return router;
}

/** Mounted at /user, keeps the assessment's `/user/:userId/chats` path intact. */
export function createUserChatRouter(service: ChatService): Router {
  const router = Router();
  const controller = createChatController(service);

  router.get('/:userId/chats', validate(listUserChatsSchema), controller.listUserChats);

  return router;
}
