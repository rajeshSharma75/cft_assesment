import { forbidden, notFound } from '../../utils/app-error';
import { UserRepository, userRepository } from './user.repository';

export interface UserDto {
  id: string;
  name: string;
  email: string;
  createdAt: string;
}

export class UserService {
  constructor(private readonly users: UserRepository = userRepository) {}

  async listUsers(): Promise<UserDto[]> {
    const users = await this.users.list();
    return users.map(mapUser);
  }

  async getUser(userId: string, actorId: string): Promise<UserDto> {
    if (userId !== actorId) {
      throw forbidden('You can only access your own user record');
    }

    const user = await this.users.findById(userId);
    if (!user) throw notFound('User not found');
    return mapUser(user);
  }
}

function mapUser(user: {
  id: string;
  name: string;
  email: string;
  createdAt: Date;
}): UserDto {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    createdAt: user.createdAt.toISOString(),
  };
}

export const userService = new UserService();
