/**
 * 用户模型
 */

export type UserRole = 'admin' | 'editor' | 'viewer';

export interface User {
  id: string;
  username: string;
  email: string;
  role: UserRole;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateUserInput {
  username: string;
  email: string;
  role?: UserRole;
}

export interface UpdateUserInput {
  username?: string;
  email?: string;
  role?: UserRole;
}
