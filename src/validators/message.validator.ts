import { z } from 'zod';

const uuid = z.string().uuid('Must be a valid UUID');

const messageParams = z.object({
  chatId: uuid,
  messageId: z.string().min(1).max(256),
});

export const sendMessageSchema = {
  params: z.object({ chatId: uuid }),
  body: z.object({
    senderId: uuid,
    text: z.string().trim().min(1, 'Message text is required').max(5000, 'Message is too long'),
    idempotencyKey: z.string().trim().min(1).max(128).optional(),
  }),
};

export const listMessagesSchema = {
  params: z.object({ chatId: uuid }),
  query: z.object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: z.string().min(1).optional(),
  }),
};

export const markMessageReadSchema = {
  params: messageParams,
  body: z.object({ userId: uuid }),
};

export const updateLastSeenSchema = {
  params: z.object({ chatId: uuid }),
  body: z.object({
    userId: uuid,
    messageId: z.string().min(1).max(256),
  }),
};

export const editMessageSchema = {
  params: messageParams,
  body: z.object({
    text: z.string().trim().min(1, 'Message text is required').max(5000, 'Message is too long'),
  }),
};

export const deleteMessageSchema = {
  params: messageParams,
};

export type SendMessageInput = z.infer<typeof sendMessageSchema.body>;
export type ListMessagesQuery = z.infer<typeof listMessagesSchema.query>;
