# Dawn v2.0 — Self-Evolving AI Coding Agent

Dawn 是一个自进化的 AI 编程助手，采用微内核 + 插件化架构，专注于本地开发效率提升。v2.0 引入 LLM 抽象层、上下文感知引用、三层记忆系统和自进化引擎。

## v2.0 亮点

| 特性 | 说明 |
|------|------|
| **LLM 抽象层** | 标准 `LLMProvider` 接口，支持 DeepSeek 等 Provider 运行时切换 |
| **上下文感知引用** | `@file <path>` 注入文件内容、`@folder <path>` 注入目录结构、`@git` 注入 Git diff |
| **三层记忆系统** | Session / Persistent / Skill 分级记忆，自动遗忘与混合检索 |
| **自进化引擎** | 代码变异 → 沙箱验证 → 自动应用，驱动自我改进 |
| **安全沙箱** | 危险命令白名单、文件路径限制、输入注入检测 |
| **工具调用缓存** | LRU + TTL 缓存，减少重复 LLM 调用 |
| **桌面面板** | Tauri + React 19 + Zustand，插件市场、进化仪表盘 |
| **Windows 原生** | 纯 JS 实现，无 Unix 依赖 |

## 快速开始

```bash
# 克隆
git clone <repo-url>
cd DawnNew

# 安装依赖
bun install

# 配置
cp .env.example .env
# 编辑 .env 填入 LLM_API_KEY

# 启动 CLI
bun run dev
```

## CLI 使用示例

```bash
# 启动交互式对话
bun run dev

# 携带文件上下文启动（注入文件内容）
bun run dev --file src/main.ts

# 对话中使用引用语法
# @file src/config.ts         — 注入文件内容
# @folder src/components/      — 注入目录结构
# @git                         — 注入当前 Git diff
# @git --staged                — 注入暂存区 diff
```

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `LLM_PROVIDER` | `deepseek` | LLM 提供商 |
| `LLM_MODEL` | `deepseek-chat` | 模型名称 |
| `LLM_API_KEY` | — | API 密钥（必填） |
| `LLM_BASE_URL` | `https://api.deepseek.com` | API 端点 |
| `TOOL_CALL_CACHE_ENABLED` | `true` | 启用工具调用缓存 |
| `MEMORY_ENABLED` | `true` | 启用记忆系统 |

## 项目结构

```
DawnNew/
├── Dawn/                    # 核心应用
│   ├── src/
│   │   ├── cli/            # CLI 入口
│   │   ├── engine/         # 核心引擎（Coordinator / Agent / ExecutionLoop）
│   │   ├── capabilities/   # 原子/复合能力层
│   │   ├── memory/         # 三层记忆系统
│   │   ├── evolution/      # 自进化引擎
│   │   ├── services/       # 公共服务（ContextService、CompactService）
│   │   ├── api/            # HTTP API 端点
│   │   └── utils/          # 工具函数
│   └── packages/           # Monorepo 共享包
│       ├── core/           # 核心类型、LLM 抽象、日志
│       ├── memory/         # 记忆库
│       └── evolution/      # 进化库
├── tests/                  # 测试（209 个用例）
├── DawnPanel/              # Tauri 桌面面板
├── ARCHITECTURE.md         # 架构文档
├── CHANGELOG.md            # 变更日志
└── README.md               # 本文件
```

## 测试

```bash
# 运行全部测试
bun test

# 覆盖率
bun run test:coverage

# CI 模式
bun run test:ci
```

## 许可

MIT
