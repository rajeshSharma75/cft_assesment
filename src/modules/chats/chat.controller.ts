import { Request, Response } from 'express';
import { asyncHandler } from '../../utils/async-handler';
import { sendSuccess } from '../../utils/api-response';
import { getAuthUser } from '../../utils/request-user';
import {
  AddMembersInput,
  CreateDirectChatInput,
  CreateGroupChatInput,
} from '../../validators/chat.validator';
import { ChatService } from './chat.service';

export function createChatController(service: ChatService) {
  return {
    createDirectChat: asyncHandler(async (req: Request, res: Response) => {
      const actor = getAuthUser(req);
      const body = req.body as CreateDirectChatInput;
      const result = await service.createOrGetDirectChat(
        { userAId: body.userAId, userBId: body.userBId },
        actor.id,
      );
      sendSuccess(res, result);
    }),

    createGroupChat: asyncHandler(async (req: Request, res: Response) => {
      const actor = getAuthUser(req);
      const body = req.body as CreateGroupChatInput;
      const chat = await service.createGroupChat(
        { name: body.name, participantIds: body.participantIds },
        actor.id,
      );
      sendSuccess(res, chat, 201);
    }),

    addMembers: asyncHandler(async (req: Request, res: Response) => {
      const actor = getAuthUser(req);
      const body = req.body as AddMembersInput;
      const result = await service.addMembers(req.params.chatId as string, actor.id, body.participantIds);
      sendSuccess(res, result);
    }),

    removeMember: asyncHandler(async (req: Request, res: Response) => {
      const actor = getAuthUser(req);
      const result = await service.removeMember(
        req.params.chatId as string,
        actor.id,
        req.params.userId as string,
      );
      sendSuccess(res, result);
    }),

    listMembers: asyncHandler(async (req: Request, res: Response) => {
      const actor = getAuthUser(req);
      const members = await service.listMembers(req.params.chatId as string, actor.id);
      sendSuccess(res, members);
    }),

    listUserChats: asyncHandler(async (req: Request, res: Response) => {
      const actor = getAuthUser(req);
      const chats = await service.listUserChats(req.params.userId as string, actor.id);
      sendSuccess(res, chats);
    }),
  };
}
