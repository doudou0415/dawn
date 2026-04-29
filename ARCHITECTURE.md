# Dawn v2.0 架构文档

## 概述

Dawn 是一个自进化的 AI 编程助手，采用微内核 + 插件化架构设计。v2.0 重构了核心抽象层，引入了统一的 LLM 接口、三层记忆系统、上下文感知引擎和进化沙箱。

## 核心架构

```
┌─────────────────────────────────────────────────┐
│                    CLI / UI                       │
├─────────────────────────────────────────────────┤
│                  Coordinator                     │
│    ┌─────────────┬──────────────┬──────────────┐ │
│    │  Context    │   Agent      │  Evolution   │ │
│    │  Service    │ (Execution   │  Engine      │ │
│    │             │   Loop)      │              │ │
│    ├─────────────┼──────────────┼──────────────┤ │
│    │  Memory     │  Capability  │  LLM         │ │
│    │  System     │  Registry   │  Provider    │ │
│    └─────────────┴──────────────┴──────────────┘ │
├─────────────────────────────────────────────────┤
│              @dawn/*  packages                    │
│    core  │  memory  │  evolution                  │
└─────────────────────────────────────────────────┘
```

### 组件说明

| 组件 | 职责 | 位置 |
|------|------|------|
| **Coordinator** | 统一调度中枢，输入验证、上下文注入、统计追踪 | `Dawn/src/engine/coordinator/` |
| **Agent** | 核心执行代理，管理 ExecutionLoop | `Dawn/src/engine/core/Agent.ts` |
| **ExecutionLoop** | 执行循环，任务路由、工具调用、自审查 | `Dawn/src/engine/core/ExecutionLoop.ts` |
| **ContextService** | 上下文感知，支持 @file/@folder/@git 引用 | `Dawn/src/engine/core/ContextService.ts` |
| **MemorySystem** | 三层记忆：session/persistent/skill | `Dawn/src/memory/` |
| **CapabilityRegistry** | 能力注册中心，路由任务到对应能力 | `Dawn/src/capabilities/registry/` |
| **SelfEvolutionEngine** | 自进化引擎，分析任务 → 生成改进建议 → 实验 | `Dawn/src/evolution/` |
| **CompactService** | 上下文压缩，防止 token 溢出 | `Dawn/src/services/compact/` |

## LLM 抽象层

v2.0 引入了标准化的 LLM Provider 接口，支持运行时切换：

```
LLMProvider (interface)
  ├── DeepSeekProvider  (production)
  └── ... (custom providers)
```

```typescript
interface LLMProvider {
  chat(messages, options?): Promise<ChatResponse>
  stream(messages, options?): AsyncIterable<Chunk>
  embed(text): Promise<number[]>
  healthCheck(): Promise<boolean>
  getModelInfo(): { model, provider }
}
```

工厂模式：`getLLMProvider()` 读取 `LLM_PROVIDER` 环境变量，返回对应 Provider 实例。

**工具调用缓存**：`LLMCache` 使用 LRU + TTL 缓存 LLM 回复，由 `TOOL_CALL_CACHE_ENABLED` 控制。

## 记忆系统

三层结构：

1. **SessionMemory** — 当前会话的短期记忆（滑动窗口）
2. **PersistentMemory** — 跨会话的持久化知识
3. **SkillMemory** — 技能模式存储

每层支持分级遗忘（short/mid/long term），自动在后台执行。

## 能力系统

原子能力（AtomicCapability）：
- **Terminal** — 命令执行（带安全白名单）
- **FileOps** — 文件读写（带沙箱路径限制）
- **Browser** — 网页搜索（带 URL 安全检查）
- **CodeGeneration** — 代码生成
- **CodeReview** — 代码审查

## 安全架构

- **终端**：危险命令白名单 + 输出大小限制(1MB) + 超时(10s)
- **文件**：沙箱路径限制（仅项目目录内）+ 敏感路径阻止
- **浏览器**：http/https 协议限制 + 内网地址阻止
- **Coordinator**：输入注入检测 + 长度限制(50K) + 权限等级

## Coordinator 执行流程

```
User Input
    │
    ▼
Coordinator.execute()
    │
    ├── 输入验证（空/长度/注入检测）
    ├── requestId 生成 (tracing)
    ├── ContextService.buildLLMContext()
    │     ├── @file 引用解析
    │     ├── @folder 目录结构
    │     └── @git diff 感知
    │
    ├── Agent.execute()
    │     ├── ExecutionLoop.run()
    │     ├── 工具调用 → Capability
    │     └── 响应生成
    │
    ├── 统计记录（duration/token/ability）
    ├── runEvolution() (异步)
    └── 返回 AgentResult
```

## 配置

环境变量（`.env`）：

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `LLM_PROVIDER` | LLM 提供商 | deepseek |
| `LLM_MODEL` | 模型名 | deepseek-chat |
| `LLM_API_KEY` | API 密钥 | — |
| `LLM_BASE_URL` | API 端点 | — |
| `TOOL_CALL_CACHE_ENABLED` | 是否启用 LLM 缓存 | true |
| `MEMORY_ENABLED` | 是否启用记忆系统 | true |

## 开发者指南

```bash
# 安装依赖
bun install

# 运行测试
bun test

# 开发模式
bun run dev

# 类型检查
bun run typecheck

# 构建
bun run build
```
