/**
 * 用户内存存储
 */

import type { User, CreateUserInput, UpdateUserInput } from './model.js';

const users = new Map<string, User>();

let nextId = 1;

function generateId(): string {
  return `user_${nextId++}_${Date.now()}`;
}

export const userStore = {
  findAll(): User[] {
    return Array.from(users.values());
  },

  findById(id: string): User | undefined {
    return users.get(id);
  },

  create(input: CreateUserInput): User {
    const now = new Date();
    const user: User = {
      id: generateId(),
      username: input.username,
      email: input.email,
      role: input.role ?? 'viewer',
      createdAt: now,
      updatedAt: now,
    };
    users.set(user.id, user);
    return user;
  },

  update(id: string, input: UpdateUserInput): User | undefined {
    const existing = users.get(id);
    if (!existing) return undefined;

    const updated: User = {
      ...existing,
      username: input.username ?? existing.username,
      email: input.email ?? existing.email,
      role: input.role ?? existing.role,
      updatedAt: new Date(),
    };
    users.set(id, updated);
    return updated;
  },

  delete(id: string): boolean {
    return users.delete(id);
  },

  /** 测试用：清空存储 */
  _reset(): void {
    users.clear();
    nextId = 1;
  },
};
