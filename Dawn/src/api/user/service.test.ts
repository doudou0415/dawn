/**
 * 用户管理 API 测试
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { userStore } from './store.js';
import { userService } from './service.js';

describe('userStore', () => {
  beforeEach(() => {
    userStore._reset();
  });

  it('创建用户并返回带 id 的用户对象', () => {
    const user = userStore.create({ username: 'alice', email: 'alice@test.com' });
    expect(user.id).toBeTruthy();
    expect(user.username).toBe('alice');
    expect(user.email).toBe('alice@test.com');
    expect(user.role).toBe('viewer');
  });

  it('创建用户时可指定角色', () => {
    const user = userStore.create({ username: 'admin', email: 'admin@test.com', role: 'admin' });
    expect(user.role).toBe('admin');
  });

  it('findAll 返回所有用户', () => {
    userStore.create({ username: 'a', email: 'a@test.com' });
    userStore.create({ username: 'b', email: 'b@test.com' });
    expect(userStore.findAll()).toHaveLength(2);
  });

  it('findById 返回对应用户', () => {
    const created = userStore.create({ username: 'x', email: 'x@test.com' });
    const found = userStore.findById(created.id);
    expect(found?.username).toBe('x');
  });

  it('findById 返回 undefined 当用户不存在', () => {
    expect(userStore.findById('nonexistent')).toBeUndefined();
  });

  it('update 修改用户字段并更新 updatedAt', () => {
    const user = userStore.create({ username: 'old', email: 'old@test.com' });
    const updated = userStore.update(user.id, { username: 'new' });
    expect(updated?.username).toBe('new');
    expect(updated?.updatedAt.getTime()).toBeGreaterThanOrEqual(user.createdAt.getTime());
  });

  it('update 返回 undefined 当用户不存在', () => {
    expect(userStore.update('x', { username: 'y' })).toBeUndefined();
  });

  it('delete 移除用户并返回 true', () => {
    const user = userStore.create({ username: 'del', email: 'del@test.com' });
    expect(userStore.delete(user.id)).toBe(true);
    expect(userStore.findById(user.id)).toBeUndefined();
  });

  it('delete 返回 false 当用户不存在', () => {
    expect(userStore.delete('x')).toBe(false);
  });
});

describe('userService', () => {
  beforeEach(() => {
    userStore._reset();
  });

  it('create 校验用户名不能为空', () => {
    expect(() => userService.create({ username: '', email: 'a@test.com' })).toThrow('用户名不能为空');
  });

  it('create 校验邮箱不能为空', () => {
    expect(() => userService.create({ username: 'a', email: '' })).toThrow('邮箱不能为空');
  });

  it('create 校验邮箱格式', () => {
    expect(() => userService.create({ username: 'a', email: 'invalid' })).toThrow('邮箱格式不正确');
  });

  it('update 抛出错误当用户不存在', () => {
    expect(() => userService.update('x', { username: 'y' })).toThrow('用户 x 不存在');
  });

  it('delete 抛出错误当用户不存在', () => {
    expect(() => userService.delete('x')).toThrow('用户 x 不存在');
  });

  it('完整 CRUD 流程', () => {
    const user = userService.create({ username: 'crud', email: 'crud@test.com', role: 'editor' });
    expect(userService.get(user.id)?.username).toBe('crud');

    const updated = userService.update(user.id, { role: 'admin' });
    expect(updated.role).toBe('admin');

    userService.delete(user.id);
    expect(userService.get(user.id)).toBeUndefined();
    expect(userService.list()).toHaveLength(0);
  });
});
