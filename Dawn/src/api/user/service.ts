/**
 * 用户管理服务 - CRUD 业务逻辑
 */

import type { User, CreateUserInput, UpdateUserInput } from './model.js';
import { userStore } from './store.js';

export const userService = {
  list(): User[] {
    return userStore.findAll();
  },

  get(id: string): User | undefined {
    return userStore.findById(id);
  },

  create(input: CreateUserInput): User {
    if (!input.username?.trim()) {
      throw new Error('用户名不能为空');
    }
    if (!input.email?.trim()) {
      throw new Error('邮箱不能为空');
    }
    // 简单邮箱格式校验
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email)) {
      throw new Error('邮箱格式不正确');
    }
    return userStore.create(input);
  },

  update(id: string, input: UpdateUserInput): User {
    const updated = userStore.update(id, input);
    if (!updated) {
      throw new Error(`用户 ${id} 不存在`);
    }
    return updated;
  },

  delete(id: string): void {
    const deleted = userStore.delete(id);
    if (!deleted) {
      throw new Error(`用户 ${id} 不存在`);
    }
  },
};
