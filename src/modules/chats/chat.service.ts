import { Chat, ChatMemberSummary } from '../../types';
import { badRequest, conflict, forbidden, notFound } from '../../utils/app-error';
import { createDirectChatKey } from '../../utils/direct-chat-key';
import { UserRepository, userRepository } from '../users/user.repository';
import { ChatRepository, chatRepository } from './chat.repository';

export interface CreateDirectChatResult {
  chatId: string;
  isExisting: boolean;
}

export interface ChatSummaryDto {
  chatId: string;
  type: 'DIRECT' | 'GROUP';
  name: string | null;
  members: string[];
  createdAt: string;
  lastActivityAt: string;
}

export interface GroupChatDto {
  chatId: string;
  type: 'GROUP';
  name: string;
  memberIds: string[];
  createdAt: string;
}

export interface MemberDto {
  userId: string;
  name: string;
  email: string;
  joinedAt: string;
}

export interface RemoveMemberResult {
  removedUserId: string;
  memberIds: string[];
}

export class ChatService {
  constructor(
    private readonly chats: ChatRepository = chatRepository,
    private readonly users: UserRepository = userRepository,
  ) {}

  /** API 1: create or return the existing 1:1 conversation for a user pair. */
  async createOrGetDirectChat(
    params: { userAId: string; userBId: string },
    actorId: string,
  ): Promise<CreateDirectChatResult> {
    const userAId = params.userAId.trim();
    const userBId = params.userBId.trim();

    if (userAId === userBId) {
      throw badRequest('A direct chat requires two different users');
    }

    if (actorId !== userAId && actorId !== userBId) {
      throw forbidden('The authenticated user must be one of the chat participants');
    }

    await this.assertUsersExist([userAId, userBId]);

    const { chat, isExisting } = await this.chats.createDirectChat({
      directChatKey: createDirectChatKey(userAId, userBId),
      userAId,
      userBId,
      createdBy: actorId,
    });

    return { chatId: chat.id, isExisting };
  }

  /** Bonus: create a group chat; the creator is always a member. */
  async createGroupChat(
    params: { name: string; participantIds: string[] },
    actorId: string,
  ): Promise<GroupChatDto> {
    const participants = [...new Set(params.participantIds.map((id) => id.trim()))].filter(
      (id) => id !== actorId,
    );

    if (participants.length < 2) {
      throw badRequest('A group chat requires at least two other participants');
    }

    await this.assertUsersExist(participants);

    const memberIds = [actorId, ...participants];
    const chat = await this.chats.createGroupChat({
      name: params.name.trim(),
      createdBy: actorId,
      memberIds,
    });

    return {
      chatId: chat.id,
      type: 'GROUP',
      name: chat.name ?? params.name.trim(),
      memberIds,
      createdAt: chat.createdAt.toISOString(),
    };
  }

  /** Bonus: add participants to an existing group chat. */
  async addMembers(
    chatId: string,
    actorId: string,
    participantIds: string[],
  ): Promise<{ addedMemberIds: string[]; memberIds: string[] }> {
    const chat = await this.getChatOrThrow(chatId);
    if (chat.type !== 'GROUP') {
      throw badRequest('Members can only be added to group chats');
    }
    await this.assertMember(chatId, actorId);

    const unique = [...new Set(participantIds.map((id) => id.trim()))];
    await this.assertUsersExist(unique);

    const addedMemberIds = await this.chats.addMembers(chatId, unique);
    const memberIds = await this.chats.listMemberIds(chatId);

    return { addedMemberIds, memberIds };
  }

  /** Bonus: leave a group, or let the creator remove another member. */
  async removeMember(
    chatId: string,
    actorId: string,
    targetUserId: string,
  ): Promise<RemoveMemberResult> {
    const chat = await this.getChatOrThrow(chatId);
    if (chat.type !== 'GROUP') {
      throw badRequest('Members can only be removed from group chats');
    }
    await this.assertMember(chatId, actorId);

    const isSelf = actorId === targetUserId;
    if (!isSelf && chat.createdBy !== actorId) {
      throw forbidden('Only the group creator can remove other members');
    }
    if (!isSelf && targetUserId === chat.createdBy) {
      throw forbidden('The group creator cannot be removed by another member');
    }

    const memberIds = await this.chats.listMemberIds(chatId);
    if (!memberIds.includes(targetUserId)) {
      throw notFound('User is not a member of this chat');
    }

    // The creator may leave, but a group must not be left without members.
    if (isSelf && chat.createdBy === actorId && memberIds.length <= 1) {
      throw conflict('The last member cannot leave the group');
    }

    const removed = await this.chats.removeMember(chatId, targetUserId);
    if (!removed) {
      throw notFound('User is not a member of this chat');
    }

    const remaining = await this.chats.listMemberIds(chatId);
    return { removedUserId: targetUserId, memberIds: remaining };
  }

  /** Bonus: list group members (works for direct chats too, but is mainly for groups). */
  async listMembers(chatId: string, actorId: string): Promise<MemberDto[]> {
    await this.getChatOrThrow(chatId);
    await this.assertMember(chatId, actorId);

    const members = await this.chats.listMembers(chatId);
    return members.map(mapMember);
  }

  /** API 6: list chats for a user, newest activity first. */
  async listUserChats(userId: string, actorId: string): Promise<ChatSummaryDto[]> {
    if (userId !== actorId) {
      throw forbidden('You can only list your own chats');
    }

    const chats = await this.chats.listChatsForUser(userId);

    return chats.map((summary) => ({
      chatId: summary.chatId,
      type: summary.type,
      name: summary.name,
      members: summary.memberIds,
      createdAt: summary.createdAt.toISOString(),
      lastActivityAt: summary.lastActivityAt.toISOString(),
    }));
  }

  async getChatOrThrow(chatId: string): Promise<Chat> {
    const chat = await this.chats.findById(chatId);
    if (!chat) throw notFound('Chat not found');
    return chat;
  }

  async assertMember(chatId: string, userId: string): Promise<void> {
    const isMember = await this.chats.isMember(chatId, userId);
    if (!isMember) throw forbidden('User does not belong to this chat');
  }

  private async assertUsersExist(userIds: string[]): Promise<void> {
    const unique = [...new Set(userIds)];
    const users = await this.users.findByIds(unique);

    if (users.length !== unique.length) {
      const found = new Set(users.map((user) => user.id));
      const missing = unique.filter((id) => !found.has(id));
      throw notFound(`User not found: ${missing.join(', ')}`);
    }
  }
}

function mapMember(member: ChatMemberSummary): MemberDto {
  return {
    userId: member.id,
    name: member.name,
    email: member.email,
    joinedAt: member.joinedAt.toISOString(),
  };
}

export const chatService = new ChatService();
