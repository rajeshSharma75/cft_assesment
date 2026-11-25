/**
 * Hand-maintained OpenAPI 3.0 document served at /api-docs.
 * Kept as a plain object so no extra tooling is required in the build.
 */

const errorSchema = {
  type: 'object',
  properties: {
    success: { type: 'boolean', example: false },
    message: { type: 'string' },
    code: { type: 'string' },
    details: { type: 'array', items: { type: 'object' } },
  },
};

const errorResponse = (description: string) => ({
  description,
  content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
});

const authErrors = {
  401: errorResponse('Missing, malformed or expired JWT'),
  403: errorResponse('Authenticated user is not allowed to perform this action'),
};

const validationErrors = {
  422: errorResponse('Request validation failed'),
  ...authErrors,
};

export const openApiDocument = {
  openapi: '3.0.3',
  info: {
    title: 'Chat Backend API',
    version: '1.0.0',
    description:
      'Chat backend with users and chats in PostgreSQL and messages, read receipts and last-seen ' +
      'state in Firebase Firestore. All /chat and /user endpoints require a Bearer JWT.',
  },
  servers: [{ url: 'http://localhost:3000', description: 'Local development' }],
  tags: [
    { name: 'Auth', description: 'Development tokens and current user' },
    { name: 'Users', description: 'Seeded user directory' },
    { name: 'Chats', description: 'Direct and group chat management' },
    { name: 'Messages', description: 'Firestore-backed messages, receipts and last seen' },
  ],
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
    },
    schemas: {
      ErrorResponse: errorSchema,
      User: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          name: { type: 'string' },
          email: { type: 'string', format: 'email' },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      ChatCreated: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: true },
          data: {
            type: 'object',
            properties: {
              chatId: { type: 'string', format: 'uuid' },
              isExisting: { type: 'boolean', example: false },
            },
          },
        },
      },
      Message: {
        type: 'object',
        properties: {
          messageId: { type: 'string' },
          chatId: { type: 'string', format: 'uuid' },
          senderId: { type: 'string', format: 'uuid' },
          text: { type: 'string', nullable: true },
          isDeleted: { type: 'boolean' },
          createdAt: { type: 'string', format: 'date-time' },
          editedAt: { type: 'string', format: 'date-time', nullable: true },
          deletedAt: { type: 'string', format: 'date-time', nullable: true },
        },
      },
      MessagePage: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: true },
          data: {
            type: 'object',
            properties: {
              messages: { type: 'array', items: { $ref: '#/components/schemas/Message' } },
              nextCursor: { type: 'string', nullable: true },
              hasMore: { type: 'boolean' },
            },
          },
        },
      },
      ChatSummary: {
        type: 'object',
        properties: {
          chatId: { type: 'string', format: 'uuid' },
          type: { type: 'string', enum: ['DIRECT', 'GROUP'] },
          name: { type: 'string', nullable: true },
          members: { type: 'array', items: { type: 'string', format: 'uuid' } },
          createdAt: { type: 'string', format: 'date-time' },
          lastActivityAt: { type: 'string', format: 'date-time' },
        },
      },
      GroupChat: {
        type: 'object',
        properties: {
          chatId: { type: 'string', format: 'uuid' },
          type: { type: 'string', enum: ['GROUP'] },
          name: { type: 'string' },
          memberIds: { type: 'array', items: { type: 'string', format: 'uuid' } },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      Member: {
        type: 'object',
        properties: {
          userId: { type: 'string', format: 'uuid' },
          name: { type: 'string' },
          email: { type: 'string', format: 'email' },
          joinedAt: { type: 'string', format: 'date-time' },
        },
      },
      ReadReceipt: {
        type: 'object',
        properties: {
          messageId: { type: 'string' },
          userId: { type: 'string', format: 'uuid' },
          status: { type: 'string', enum: ['READ'] },
          readAt: { type: 'string', format: 'date-time' },
        },
      },
      LastSeen: {
        type: 'object',
        properties: {
          userId: { type: 'string', format: 'uuid' },
          lastSeenMessageId: { type: 'string' },
          lastSeenAt: { type: 'string', format: 'date-time' },
        },
      },
    },
  },
  security: [{ bearerAuth: [] }],
  paths: {
    '/health': {
      get: {
        tags: ['Auth'],
        summary: 'Health check',
        security: [],
        responses: {
          200: {
            description: 'Service status',
            content: {
              'application/json': {
                example: {
                  success: true,
                  data: {
                    service: 'chat-backend',
                    status: 'ok',
                    database: 'up',
                    firebaseConfigured: true,
                  },
                },
              },
            },
          },
          503: { description: 'Database is unreachable (status degraded)' },
        },
      },
    },
    '/auth/dev-token': {
      post: {
        tags: ['Auth'],
        summary: 'Issue a development JWT for a seeded user',
        description: 'Disabled when NODE_ENV=production. There is no registration or password flow.',
        security: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email'],
                properties: { email: { type: 'string', format: 'email' } },
              },
              example: { email: 'aarav.sharma@example.com' },
            },
          },
        },
        responses: {
          200: {
            description: 'JWT issued',
            content: {
              'application/json': {
                example: {
                  success: true,
                  data: {
                    token: 'eyJhbGciOiJIUzI1NiIs...',
                    tokenType: 'Bearer',
                    expiresIn: '1d',
                    user: {
                      id: '11111111-1111-4111-8111-111111111111',
                      name: 'Aarav Sharma',
                      email: 'aarav.sharma@example.com',
                    },
                  },
                },
              },
            },
          },
          404: errorResponse('No seeded user with that email'),
          422: errorResponse('Invalid email'),
        },
      },
    },
    '/auth/me': {
      get: {
        tags: ['Auth'],
        summary: 'Return the authenticated user from the JWT',
        responses: { 200: { description: 'Current user' }, ...authErrors },
      },
    },
    '/users': {
      get: {
        tags: ['Users'],
        summary: 'List seeded users',
        responses: { 200: { description: 'Users list' }, ...authErrors },
      },
    },
    '/chat/create': {
      post: {
        tags: ['Chats'],
        summary: 'Create or get a 1:1 chat',
        description:
          'Creates a deterministic direct conversation. Repeating the call in any order returns the same chatId. ' +
          'The authenticated user must be one of the participants.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['userAId', 'userBId'],
                properties: {
                  userAId: { type: 'string', format: 'uuid' },
                  userBId: { type: 'string', format: 'uuid' },
                },
              },
              example: {
                userAId: '11111111-1111-4111-8111-111111111111',
                userBId: '22222222-2222-4222-8222-222222222222',
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Existing or newly created chat',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ChatCreated' } } },
          },
          400: errorResponse('Same user supplied twice'),
          404: errorResponse('One or both users do not exist'),
          ...validationErrors,
        },
      },
    },
    '/chat/group/create': {
      post: {
        tags: ['Chats'],
        summary: 'Create a group chat',
        description: 'The authenticated user becomes the creator and a member. At least two other participants are required.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name', 'participantIds'],
                properties: {
                  name: { type: 'string', maxLength: 100 },
                  participantIds: {
                    type: 'array',
                    minItems: 2,
                    items: { type: 'string', format: 'uuid' },
                  },
                },
              },
              example: {
                name: 'Development Team',
                participantIds: [
                  '11111111-1111-4111-8111-111111111111',
                  '22222222-2222-4222-8222-222222222222',
                  '33333333-3333-4333-8333-333333333333',
                ],
              },
            },
          },
        },
        responses: {
          201: {
            description: 'Group chat created',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { success: { type: 'boolean' }, data: { $ref: '#/components/schemas/GroupChat' } },
                },
              },
            },
          },
          404: errorResponse('A participant does not exist'),
          ...validationErrors,
        },
      },
    },
    '/chat/{chatId}/messages': {
      get: {
        tags: ['Messages'],
        summary: 'List messages (chronological, cursor-paginated)',
        parameters: [
          { name: 'chatId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 50 } },
          {
            name: 'cursor',
            in: 'query',
            description: 'Opaque nextCursor from the previous page',
            schema: { type: 'string' },
          },
        ],
        responses: {
          200: {
            description: 'Ordered message page',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/MessagePage' } } },
          },
          400: errorResponse('Invalid cursor'),
          404: errorResponse('Chat not found'),
          ...validationErrors,
        },
      },
    },
    '/chat/{chatId}/message/send': {
      post: {
        tags: ['Messages'],
        summary: 'Send a message',
        description:
          'Stores the message in Firestore with a server timestamp, then bumps chat activity in PostgreSQL. ' +
          'Supply an Idempotency-Key header (or idempotencyKey body field) to make retries safe.',
        parameters: [
          { name: 'chatId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          { name: 'Idempotency-Key', in: 'header', schema: { type: 'string', maxLength: 128 } },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['senderId', 'text'],
                properties: {
                  senderId: { type: 'string', format: 'uuid' },
                  text: { type: 'string', maxLength: 5000 },
                  idempotencyKey: { type: 'string', maxLength: 128 },
                },
              },
              example: {
                senderId: '11111111-1111-4111-8111-111111111111',
                text: 'Hello, how are you?',
              },
            },
          },
        },
        responses: {
          201: {
            description: 'Stored message',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { success: { type: 'boolean' }, data: { $ref: '#/components/schemas/Message' } },
                },
              },
            },
          },
          404: errorResponse('Chat not found'),
          503: errorResponse('Firestore unavailable'),
          ...validationErrors,
        },
      },
    },
    '/chat/{chatId}/message/{messageId}/read': {
      post: {
        tags: ['Messages'],
        summary: 'Mark a message as read',
        description: 'Idempotent: repeated calls keep the original readAt. Users cannot mark their own message as read.',
        parameters: [
          { name: 'chatId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          { name: 'messageId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['userId'],
                properties: { userId: { type: 'string', format: 'uuid' } },
              },
              example: { userId: '22222222-2222-4222-8222-222222222222' },
            },
          },
        },
        responses: {
          200: {
            description: 'Read receipt',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { success: { type: 'boolean' }, data: { $ref: '#/components/schemas/ReadReceipt' } },
                },
              },
            },
          },
          404: errorResponse('Chat or message not found'),
          ...validationErrors,
        },
      },
    },
    '/chat/{chatId}/lastseen': {
      post: {
        tags: ['Messages'],
        summary: 'Update last seen message',
        description: 'Never moves the position backwards; implemented with a Firestore transaction.',
        parameters: [{ name: 'chatId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['userId', 'messageId'],
                properties: {
                  userId: { type: 'string', format: 'uuid' },
                  messageId: { type: 'string' },
                },
              },
              example: {
                userId: '22222222-2222-4222-8222-222222222222',
                messageId: '6f1c2b7e-6c5a-4f43-9c0e-2f4d1c5b8a90',
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Last seen position',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { success: { type: 'boolean' }, data: { $ref: '#/components/schemas/LastSeen' } },
                },
              },
            },
          },
          404: errorResponse('Chat or message not found'),
          ...validationErrors,
        },
      },
    },
    '/chat/{chatId}/message/{messageId}': {
      patch: {
        tags: ['Messages'],
        summary: 'Edit a message',
        description: 'Only the original sender can edit, and deleted messages cannot be edited. createdAt is preserved.',
        parameters: [
          { name: 'chatId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          { name: 'messageId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['text'],
                properties: { text: { type: 'string', maxLength: 5000 } },
              },
              example: { text: 'Updated message' },
            },
          },
        },
        responses: {
          200: {
            description: 'Updated message',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { success: { type: 'boolean' }, data: { $ref: '#/components/schemas/Message' } },
                },
              },
            },
          },
          404: errorResponse('Chat or message not found'),
          409: errorResponse('Message is deleted'),
          ...validationErrors,
        },
      },
      delete: {
        tags: ['Messages'],
        summary: 'Soft-delete a message',
        description: 'Only the original sender can delete. Text is cleared, isDeleted/deletedAt are set and the document is retained.',
        parameters: [
          { name: 'chatId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          { name: 'messageId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: {
          200: {
            description: 'Deleted message placeholder',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { success: { type: 'boolean' }, data: { $ref: '#/components/schemas/Message' } },
                },
              },
            },
          },
          404: errorResponse('Chat or message not found'),
          ...validationErrors,
        },
      },
    },
    '/chat/{chatId}/members': {
      get: {
        tags: ['Chats'],
        summary: 'List chat members',
        parameters: [{ name: 'chatId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: {
          200: {
            description: 'Members with basic user information',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: { type: 'array', items: { $ref: '#/components/schemas/Member' } },
                  },
                },
              },
            },
          },
          404: errorResponse('Chat not found'),
          ...authErrors,
        },
      },
      post: {
        tags: ['Chats'],
        summary: 'Add group members',
        parameters: [{ name: 'chatId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['participantIds'],
                properties: {
                  participantIds: { type: 'array', minItems: 1, items: { type: 'string', format: 'uuid' } },
                },
              },
              example: { participantIds: ['44444444-4444-4444-8444-444444444444'] },
            },
          },
        },
        responses: {
          200: {
            description: 'Members added',
            content: {
              'application/json': {
                example: {
                  success: true,
                  data: { addedMemberIds: ['44444444-4444-4444-8444-444444444444'], memberIds: ['...'] },
                },
              },
            },
          },
          400: errorResponse('Direct chats do not support membership management'),
          404: errorResponse('Chat or user not found'),
          ...validationErrors,
        },
      },
    },
    '/chat/{chatId}/members/{userId}': {
      delete: {
        tags: ['Chats'],
        summary: 'Remove a group member (or leave)',
        description: 'Members can remove themselves. Only the creator can remove someone else, and the creator cannot be removed by others.',
        parameters: [
          { name: 'chatId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          { name: 'userId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: {
          200: { description: 'Member removed' },
          400: errorResponse('Direct chats do not support membership management'),
          404: errorResponse('Chat or member not found'),
          409: errorResponse('Last member cannot leave'),
          ...authErrors,
        },
      },
    },
    '/user/{userId}/chats': {
      get: {
        tags: ['Chats'],
        summary: 'List chats for a user',
        description: 'PostgreSQL-backed, sorted by latest activity. Users can only list their own chats.',
        parameters: [
          { name: 'userId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: {
          200: {
            description: 'Chats with member IDs',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: { type: 'array', items: { $ref: '#/components/schemas/ChatSummary' } },
                  },
                },
              },
            },
          },
          ...validationErrors,
        },
      },
    },
  },
};
