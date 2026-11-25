import { LastSeenPosition, MessagePage, MessageRecord, ReadReceipt } from '../../types';
import { MessageCursor } from '../../utils/cursor';

export interface CreateMessageInput {
  chatId: string;
  senderId: string;
  text: string;
  idempotencyKey?: string;
}

/**
 * Persistence boundary for everything that lives in Firestore. Keeping this as
 * an interface lets unit tests use a fake and lets the production app swap in
 * the Firebase implementation without leaking SDK details into services.
 */
export interface MessageStore {
  createMessage(input: CreateMessageInput): Promise<MessageRecord>;
  getMessage(chatId: string, messageId: string): Promise<MessageRecord | null>;
  listMessages(
    chatId: string,
    limit: number,
    cursor: MessageCursor | null,
  ): Promise<MessagePage>;
  markMessageRead(chatId: string, messageId: string, userId: string): Promise<ReadReceipt>;
  setLastSeen(chatId: string, userId: string, messageId: string): Promise<LastSeenPosition>;
  editMessage(chatId: string, messageId: string, text: string): Promise<MessageRecord>;
  deleteMessage(chatId: string, messageId: string): Promise<MessageRecord>;
}
