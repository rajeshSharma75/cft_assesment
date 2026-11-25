export type ChatType = 'DIRECT' | 'GROUP';

export interface User {
  id: string;
  name: string;
  email: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserRow {
  id: string;
  name: string;
  email: string;
  created_at: Date;
  updated_at: Date;
}

export interface Chat {
  id: string;
  name: string | null;
  type: ChatType;
  directChatKey: string | null;
  createdBy: string;
  lastActivityAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface ChatRow {
  id: string;
  name: string | null;
  type: ChatType;
  direct_chat_key: string | null;
  created_by: string;
  last_activity_at: Date;
  created_at: Date;
  updated_at: Date;
}

export interface ChatMemberRow {
  id: string;
  chat_id: string;
  user_id: string;
  joined_at: Date;
}

export interface ChatMemberSummary {
  id: string;
  name: string;
  email: string;
  joinedAt: Date;
}

export interface MessageRecord {
  id: string;
  chatId: string;
  senderId: string;
  text: string | null;
  isDeleted: boolean;
  createdAt: Date;
  editedAt: Date | null;
  deletedAt: Date | null;
}

export interface MessageDto {
  messageId: string;
  chatId: string;
  senderId: string;
  text: string | null;
  isDeleted: boolean;
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
}

export interface ReadReceipt {
  status: 'READ';
  readAt: Date;
}

export interface LastSeenPosition {
  lastSeenMessageId: string;
  lastSeenAt: Date;
}

export interface MessagePage {
  messages: MessageRecord[];
  hasMore: boolean;
  nextCursor: import('../utils/cursor').MessageCursor | null;
}

export interface ChatSummary {
  chatId: string;
  type: ChatType;
  name: string | null;
  memberIds: string[];
  createdAt: Date;
  lastActivityAt: Date;
}
