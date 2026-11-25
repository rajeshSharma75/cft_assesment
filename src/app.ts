import express, { Express } from 'express';
import swaggerUi from 'swagger-ui-express';
import { checkDatabaseConnection } from './config/database';
import { isFirebaseConfigured } from './config/firebase';
import { openApiDocument } from './docs/openapi';
import { authenticate } from './middlewares/auth.middleware';
import { errorHandler, notFoundHandler } from './middlewares/error.middleware';
import { asyncHandler } from './utils/async-handler';
import { sendSuccess } from './utils/api-response';
import { AuthService } from './modules/auth/auth.service';
import { createAuthRouter } from './modules/auth/auth.routes';
import { UserService } from './modules/users/user.service';
import { createUserRouter } from './modules/users/user.routes';
import { ChatService } from './modules/chats/chat.service';
import { createChatRouter, createUserChatRouter } from './modules/chats/chat.routes';
import { MessageService } from './modules/chats/message.service';
import { createMessageRouter } from './modules/chats/message.routes';
import { MessageStore } from './modules/chats/message.store';
import { createFirestoreMessageStore } from './modules/chats/firestore-message.store';

export interface AppDependencies {
  messageStore?: MessageStore;
  chatService?: ChatService;
  messageService?: MessageService;
  authService?: AuthService;
  userService?: UserService;
}

export function createApp(dependencies: AppDependencies = {}): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '100kb' }));

  const messageStore = dependencies.messageStore ?? createFirestoreMessageStore();
  const chatService = dependencies.chatService ?? new ChatService();
  const messageService = dependencies.messageService ?? new MessageService(messageStore);
  const authService = dependencies.authService ?? new AuthService();
  const userService = dependencies.userService ?? new UserService();

  app.get(
    '/health',
    asyncHandler(async (_req, res) => {
      // Health is a live probe: never let a browser or proxy replay an old 503.
      res.set('Cache-Control', 'no-store');

      let databaseUp = false;
      try {
        databaseUp = await checkDatabaseConnection();
      } catch {
        databaseUp = false;
      }

      sendSuccess(
        res,
        {
          service: 'chat-backend',
          status: databaseUp ? 'ok' : 'degraded',
          database: databaseUp ? 'up' : 'down',
          firebaseConfigured: isFirebaseConfigured(),
        },
        databaseUp ? 200 : 503,
      );
    }),
  );

  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(openApiDocument));
  app.get('/api-docs.json', (_req, res) => {
    res.json(openApiDocument);
  });

  app.use('/auth', createAuthRouter(authService));
  app.use('/users', createUserRouter(userService));
  app.use('/chat', authenticate, createMessageRouter(messageService), createChatRouter(chatService));
  app.use('/user', authenticate, createUserChatRouter(chatService));

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
