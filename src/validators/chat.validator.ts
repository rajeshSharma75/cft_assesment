import { z } from 'zod';

const uuid = z.string().uuid('Must be a valid UUID');

export const createDirectChatSchema = {
  body: z.object({
    userAId: uuid,
    userBId: uuid,
  }),
};

export const createGroupChatSchema = {
  body: z.object({
    name: z.string().trim().min(1, 'Group name is required').max(100),
    participantIds: z.array(uuid).min(2, 'At least two participants are required').max(50),
  }),
};

export const chatIdParamsSchema = {
  params: z.object({
    chatId: uuid,
  }),
};

export const addMembersSchema = {
  params: z.object({
    chatId: uuid,
  }),
  body: z.object({
    participantIds: z.array(uuid).min(1, 'At least one participant is required').max(50),
  }),
};

export const removeMemberSchema = {
  params: z.object({
    chatId: uuid,
    userId: uuid,
  }),
};

export const listUserChatsSchema = {
  params: z.object({
    userId: uuid,
  }),
};

export type CreateDirectChatInput = z.infer<typeof createDirectChatSchema.body>;
export type CreateGroupChatInput = z.infer<typeof createGroupChatSchema.body>;
export type AddMembersInput = z.infer<typeof addMembersSchema.body>;
