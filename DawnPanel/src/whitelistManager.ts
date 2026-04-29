// 白名单配置管理
import { join, dirname } from 'path';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';

const CONFIG_DIR = join(__dirname, '../config');
const WHITELIST_FILE = join(CONFIG_DIR, 'whitelist.json');

interface WhitelistConfig {
  directories: string[];
  permissionLevel: number; // 1-5
  mode: 'plan' | 'default' | 'acceptEdits' | 'auto' | 'bypass';
}

function loadWhitelist(): WhitelistConfig {
  if (!existsSync(WHITELIST_FILE)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
    const defaultConfig: WhitelistConfig = {
      directories: ['D:/AI/DawnNew'],
      permissionLevel: 3,
      mode: 'acceptEdits',
    };
    writeFileSync(WHITELIST_FILE, JSON.stringify(defaultConfig, null, 2));
    return defaultConfig;
  }
  try {
    const content = readFileSync(WHITELIST_FILE, 'utf-8');
    return JSON.parse(content);
  } catch {
    return { directories: [], permissionLevel: 3, mode: 'acceptEdits' };
  }
}

function saveWhitelist(config: WhitelistConfig): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(WHITELIST_FILE, JSON.stringify(config, null, 2));
}

export function addToWhitelist(path: string): string {
  const config = loadWhitelist();
  const normalizedPath = path.replace(/\//g, '\\');
  if (config.directories.includes(normalizedPath)) {
    return `❌ 路径已在白名单中: ${path}`;
  }
  if (!existsSync(path)) {
    return `❌ 路径不存在: ${path}`;
  }
  config.directories.push(normalizedPath);
  saveWhitelist(config);
  return `✅ 已添加到白名单: ${path}\n当前白名单共 ${config.directories.length} 个目录`;
}

export function removeFromWhitelist(path: string): string {
  const config = loadWhitelist();
  const normalizedPath = path.replace(/\//g, '\\');
  const index = config.directories.indexOf(normalizedPath);
  if (index === -1) {
    return `❌ 路径不在白名单中: ${path}`;
  }
  config.directories.splice(index, 1);
  saveWhitelist(config);
  return `✅ 已从白名单移除: ${path}\n当前白名单共 ${config.directories.length} 个目录`;
}

export function listWhitelist(): string {
  const config = loadWhitelist();
  if (config.directories.length === 0) {
    return '白名单为空，使用 `/whitelist add <路径>` 添加目录';
  }
  const list = config.directories.map((dir, i) => `${i + 1}. ${dir}`).join('\n');
  return `## 白名单目录 (${config.directories.length} 个)\n\n${list}\n\n**当前模式**: ${config.mode}\n**权限级别**: ${config.permissionLevel}级`;
}

export function clearWhitelist(): string {
  saveWhitelist({ directories: [], permissionLevel: 3, mode: 'acceptEdits' });
  return '✅ 已清空白名单';
}

export function setPermissionMode(mode: string): string {
  const validModes: WhitelistConfig['mode'][] = ['plan', 'default', 'acceptEdits', 'auto', 'bypass'];
  if (!validModes.includes(mode as WhitelistConfig['mode'])) {
    return `❌ 无效模式，可选: ${validModes.join(', ')}`;
  }
  const config = loadWhitelist();
  config.mode = mode as WhitelistConfig['mode'];
  // 根据模式设置权限级别
  const modeLevelMap: Record<string, number> = {
    plan: 1,
    default: 2,
    acceptEdits: 3,
    auto: 4,
    bypass: 5,
  };
  config.permissionLevel = modeLevelMap[mode];
  saveWhitelist(config);
  return `✅ 已设置模式: ${mode} (权限级别 ${config.permissionLevel}级)`;
}

export function getWhitelistDirectories(): string[] {
  return loadWhitelist().directories;
}

export function getPermissionLevel(): number {
  return loadWhitelist().permissionLevel;
}

export function getPermissionMode(): string {
  return loadWhitelist().mode;
}