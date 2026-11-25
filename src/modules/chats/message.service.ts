import { MessageDto, MessageRecord } from '../../types';
import { conflict, forbidden, notFound } from '../../utils/app-error';
import { decodeCursor, encodeCursor, MessageCursor } from '../../utils/cursor';
import { ChatRepository, chatRepository } from './chat.repository';
import { MessageStore } from './message.store';
import { SendMessageInput } from '../../validators/message.validator';

export interface MessagePageDto {
  messages: MessageDto[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface ReadReceiptDto {
  messageId: string;
  userId: string;
  status: 'READ';
  readAt: string;
}

export interface LastSeenDto {
  userId: string;
  lastSeenMessageId: string;
  lastSeenAt: string;
}

export function toMessageDto(message: MessageRecord): MessageDto {
  return {
    messageId: message.id,
    chatId: message.chatId,
    senderId: message.senderId,
    text: message.isDeleted ? null : message.text,
    isDeleted: message.isDeleted,
    createdAt: message.createdAt.toISOString(),
    editedAt: message.editedAt ? message.editedAt.toISOString() : null,
    deletedAt: message.deletedAt ? message.deletedAt.toISOString() : null,
  };
}

export class MessageService {
  constructor(
    private readonly store: MessageStore,
    private readonly chats: ChatRepository = chatRepository,
  ) {}

  /** API 2: persist a message in Firestore, then bump chat activity in PostgreSQL. */
  async sendMessage(
    chatId: string,
    input: SendMessageInput,
    actorId: string,
  ): Promise<MessageDto> {
    if (input.senderId !== actorId) {
      throw forbidden('senderId does not match the authenticated user');
    }

    await this.assertChatAccess(chatId, actorId);

    const message = await this.store.createMessage({
      chatId,
      senderId: input.senderId,
      text: input.text,
      ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
    });

    // Firestore and PostgreSQL are not one transaction: the message is already
    // durable, so a failed activity update must not fail the request.
    try {
      await this.chats.touchActivity(chatId);
    } catch (error) {
      console.warn(
        '[chats] failed to update last activity after message send:',
        error instanceof Error ? error.message : 'unknown error',
      );
    }

    return toMessageDto(message);
  }

  /** API 3: chronological, cursor-paginated message history. */
  async listMessages(
    chatId: string,
    actorId: string,
    options: { limit: number; cursor?: string | undefined },
  ): Promise<MessagePageDto> {
    await this.assertChatAccess(chatId, actorId);

    const cursor: MessageCursor | null = options.cursor
      ? decodeCursor(options.cursor)
      : null;

    const page = await this.store.listMessages(chatId, options.limit, cursor);

    return {
      messages: page.messages.map(toMessageDto),
      nextCursor: page.nextCursor ? encodeCursor(page.nextCursor) : null,
      hasMore: page.hasMore,
    };
  }

  /** API 4: idempotent read receipt for one user and one message. */
  async markMessageRead(
    chatId: string,
    messageId: string,
    userId: string,
    actorId: string,
  ): Promise<ReadReceiptDto> {
    if (userId !== actorId) {
      throw forbidden('userId does not match the authenticated user');
    }

    await this.assertChatAccess(chatId, actorId);

    const message = await this.getMessageOrThrow(chatId, messageId);
    if (message.senderId === userId) {
      throw forbidden('You cannot mark your own message as read');
    }

    const receipt = await this.store.markMessageRead(chatId, messageId, userId);
    return {
      messageId,
      userId,
      status: receipt.status,
      readAt: receipt.readAt.toISOString(),
    };
  }

  /** API 5: remember how far a member has read; never moves backwards. */
  async updateLastSeen(
    chatId: string,
    userId: string,
    messageId: string,
    actorId: string,
  ): Promise<LastSeenDto> {
    if (userId !== actorId) {
      throw forbidden('userId does not match the authenticated user');
    }

    await this.assertChatAccess(chatId, actorId);
    await this.getMessageOrThrow(chatId, messageId);

    const position = await this.store.setLastSeen(chatId, userId, messageId);

    return {
      userId,
      lastSeenMessageId: position.lastSeenMessageId,
      lastSeenAt: position.lastSeenAt.toISOString(),
    };
  }

  /** Bonus: only the original sender may edit, and not after deletion. */
  async editMessage(
    chatId: string,
    messageId: string,
    text: string,
    actorId: string,
  ): Promise<MessageDto> {
    await this.assertChatAccess(chatId, actorId);

    const message = await this.getMessageOrThrow(chatId, messageId);
    if (message.senderId !== actorId) {
      throw forbidden('Only the original sender can edit this message');
    }
    if (message.isDeleted) {
      throw conflict('Deleted messages cannot be edited');
    }

    const updated = await this.store.editMessage(chatId, messageId, text);
    return toMessageDto(updated);
  }

  /** Bonus: soft delete, only by the original sender. */
  async deleteMessage(
    chatId: string,
    messageId: string,
    actorId: string,
  ): Promise<MessageDto> {
    await this.assertChatAccess(chatId, actorId);

    const message = await this.getMessageOrThrow(chatId, messageId);
    if (message.senderId !== actorId) {
      throw forbidden('Only the original sender can delete this message');
    }

    const deleted = await this.store.deleteMessage(chatId, messageId);
    return toMessageDto(deleted);
  }

  private async assertChatAccess(chatId: string, userId: string): Promise<void> {
    const chat = await this.chats.findById(chatId);
    if (!chat) throw notFound('Chat not found');

    const isMember = await this.chats.isMember(chatId, userId);
    if (!isMember) throw forbidden('User does not belong to this chat');
  }

  private async getMessageOrThrow(chatId: string, messageId: string): Promise<MessageRecord> {
    const message = await this.store.getMessage(chatId, messageId);
    if (!message) throw notFound('Message not found');
    return message;
  }
}
