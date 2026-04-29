# Dawn v2.0 — Self-Evolving AI Coding Agent

Dawn 是一个自进化的 AI 编程助手 v2.0，采用微内核 + 插件化架构，专注于本地开发效率提升。

## 特性

- **自进化引擎** — 自动分析任务、生成改进建议、运行实验
- **三层记忆系统** — session / persistent / skill，分级遗忘
- **LLM 抽象层** — 标准接口，支持多 Provider 切换
- **上下文感知** — 支持 `@file`、`@folder`、`@git` 引用注入
- **能力系统** — 终端执行、文件操作、网页搜索、代码生成/审查
- **安全沙箱** — 危险命令白名单、文件路径限制、输入验证
- **工具调用缓存** — LRU + TTL 缓存，减少重复 LLM 调用
- **Windows 原生** — 纯 JS 实现，无 Unix 依赖

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

# 启动
bun run dev
```

## 环境变量配置

创建 `.env` 文件：

```
LLM_PROVIDER=deepseek
LLM_MODEL=deepseek-chat
LLM_API_KEY=your_api_key_here
LLM_BASE_URL=https://api.deepseek.com
TOOL_CALL_CACHE_ENABLED=true
MEMORY_ENABLED=true
```

## 项目结构

```
DawnNew/
├── Dawn/                    # 核心应用
│   ├── src/
│   │   ├── cli/            # CLI 入口
│   │   ├── engine/         # 核心引擎（Coordinator / Agent / ExecutionLoop）
│   │   ├── capabilities/   # 能力系统
│   │   ├── memory/         # 三层记忆系统
│   │   ├── evolution/      # 自进化引擎
│   │   ├── services/       # 公共服务（CompactService 等）
│   │   ├── api/            # API 层
│   │   └── utils/          # 工具函数
│   └── packages/           # Monorepo 包
│       ├── core/           # 核心类型、LLM 抽象
│       ├── memory/         # 记忆库
│       └── evolution/      # 进化库
├── tests/                  # 集成测试
├── DawnPanel/              # Tauri 桌面面板
├── ARCHITECTURE.md         # 架构文档
├── CHANGELOG.md            # 变更日志
└── README.md               # 本文件
```

## 测试

```bash
# 运行全部测试
bun test

# 测试覆盖率
bun run test:coverage

# 持续集成模式
bun run test:ci
```

## 许可

MIT
