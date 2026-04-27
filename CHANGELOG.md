# Changelog

## [1.0.0] — 2026-04-26

### Phase 6: 测试体系 + 清理优化 + 文档发布

- **测试体系**: 建立 12 个测试文件 / 100+ 用例，覆盖 engine / memory / evolution / capabilities / IPC 核心链路
- **旧文件清理**: 删除 13 个遗留旧文件（包括 101KB 的上帝对象 AgentCore.ts），修复 8 个文件的 import 路径
- **性能优化**:
  - HybridRetriever 加入 LRU 缓存，减少重复文件 I/O
  - MemorySystem 后台定时自动遗忘（默认 30 分钟）
- **安全加固**:
  - EvolutionSandbox 增加 `packages/`、`DawnPanel/`、`node_modules/` 保护路径
  - 路径穿越防护、命令注入防护增强
- **暗黑模式**: DawnPanel 支持 CSS 变量主题切换 + Zustand store 持久化
- **ErrorBoundary**: 全局错误捕获组件
- **文档**: README / CHANGELOG / .env.example 完整撰写
- **脚本**: 新增 `build:all` / `test:coverage` / `tauri:dev` / `release` 脚本

### Phase 5: DawnPanel 桌面客户端重构

- **Vanilla JS → React**: 787 行旧 app.ts 全部重写为 React 19 + Zustand + TanStack Query
- **Plugin Market**: 插件列表、搜索、安装（本地路径 / Git URL）、启用/禁用、卸载
- **Evolution Dashboard**: 实时进化状态、历史记录、触发进化、沙箱日志
- **IpcBridge**: 完整通信层（心跳检测、自动重连、请求队列、超时处理）
- **Tab 路由**: Chat / Evolution / Plugins / Settings / About 页面切换
- **Sidebar**: 导航项、连接状态指示器、版本号、主题切换
- **后端 API**: HTTP 端点统一（`/chat/`, `/plugins/`, `/evolution/`, `/memory/`, `/status/`）

### Phase 4: 自进化引擎 + 只读沙箱

- **SelfEvolutionEngine**: 全闭环自进化（分析 → 变异 → 验证 → 应用）
- **CodeMutator**: 智能代码变异（重构、性能优化、错误修复、风格统一）
- **EvolutionSandbox**: 只读沙箱，多层路径保护（protectedPaths / safePaths），文件操作白名单
- **skillGenerator**: 进化触发的技能生成管道
- **EvolutionPackage**: 进化结果结构化输出（diff / 状态 / 指标）

### Phase 3: 三层记忆系统

- **MemorySystem**: 统一入口（save / retrieve / forget）
- **EphemeralMemory**: 对话级短期记忆，TTL 过期自动遗忘
- **PersistentMemory**: 长期知识 + 用户偏好（JSON 文件持久化）
- **SkillMemory**: 可执行技能存储 + 匹配
- **HybridRetriever**: 三层联合检索（按 layer weight 加权排序，带 LRU 缓存）
- **AutoForget**: 后台定时器自动清理过期记忆（默认 30 分钟）

### Phase 2: Capabilities 能力层重构

- **原子/复合分层**: `atomic/`（单一能力）+ `composite/`（复合能力）+ `registry/`（注册中心）
- **AtomicCapabilityRegistry**: 热插拔注册中心，支持运行时 register / unregister
- **AtomicCapability**: 浏览器控制、文件操作、代码审查等单一能力
- **CompositeCapability**: 全栈开发、对话等复合能力

### Phase 1: Engine 核心拆解

- **Agent**: 287 行（原 2819 行），聚焦执行编排
- **ExecutionLoop**: 独立运行循环，含 fallback 响应
- **Coordinator**: 能力协调 + 任务分发
- **IntentEngine**: 意图分析 + 分类

### Phase 0: 项目初始化

- 目录结构搭建、Monorepo 配置（workspaces）
- 核心类型共享包（`packages/core/`, `packages/evolution/`, `packages/memory/`）
- CLI 入口 + 基础配置
