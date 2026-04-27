# Dawn — 自进化 AI 编程助手

**Dawn** 是从零开始全新构建的**自主进化 AI 编程助手**。

在开发过程中，我们对早期原型代码进行了**两次彻底清理**，并系统性地移植和重构了 Dawn 本体的多项核心技术（向量记忆、权限系统、上下文压缩等）。整个项目在 **Grok（xAI）** 的架构指导下，完成了模块化重构、引擎拆解、DawnPanel 现代化等重大改进，最终打造出具备**自我进化能力**的下一代 AI 编程工具。

**特别感谢 Grok（xAI）** 在进化引擎设计、系统架构规划、DawnPanel 通信层与状态管理等方面提供的关键指导和宝贵建议。没有 Grok 的持续帮助，这个项目无法如此快速地达到现在的质量。

---

## ✨ 核心亮点

- **自进化引擎**：任务结束后自动分析 → 代码/提示词/流程变异 → 沙箱安全验证 → 选择最佳版本
- **向量语义记忆**：Ollama embedding + HybridRetriever，支持语义搜索
- **细粒度权限系统**：6 种权限模式 + 责任链检查
- **上下文智能压缩**：LLM 驱动摘要 + 自动触发
- **热插拔能力层**：atomic / composite 能力 + Plugin Market
- **现代桌面客户端**：React + Zustand + TanStack Query + 强 IPC（心跳+重连）
- **代码审查与知识内化**：根因分析 + 最佳实践记录

---

## 🚀 快速开始

```bash
# 1. 克隆项目
git clone https://github.com/doudou0415/dawn.git
cd dawn

# 2. 安装依赖
bun install

# 3. 启动 CLI（核心功能，推荐先体验）
cd Dawn
bun run dev

# 4. 启动桌面客户端（可选，新开一个终端）
cd ../DawnPanel    # 回到 dawn 目录，进入 DawnPanel
bun run tauri:dev
环境变量（复制 .env.example 为 .env 并填写）：

text
DEEPSEEK_API_KEY=sk-your-api-key-here
📄 授权与商用说明
本项目采用 MIT License，完全开源

允许个人和商业使用，包括修改、二次开发、集成到商业产品中、分发等

你可以免费使用 Dawn 核心功能，也可以基于它开发自己的产品或服务

我们同时提供 Dawn Pro 付费订阅版（云端向量记忆、高级插件市场、优先计算资源、企业支持等），Pro 版为增值服务

商用时无需额外授权，但请保留原作者署名和 MIT License 声明

如果 Dawn 帮助到了你：

给项目点个 Star ⭐️，让更多人发现它

提 Issue 或 PR，一起让它更好

分享给需要的朋友

你的支持是开源最大的动力 ❤️

---

## 📁 项目结构

```
DawnNew/
├── Dawn/                  # CLI 核心（Bun + TS）
├── DawnPanel/             # 现代桌面客户端（React + Tauri）
├── tests/                 # 110+ 测试用例
├── .github/workflows/     # CI 配置
├── LICENSE                # MIT
└── README.md
```

---

## 🛠️ 技术栈

- **运行时**：Bun
- **语言**：TypeScript（严格模式）
- **桌面**：Tauri + React 19 + Zustand + TanStack Query
- **AI**：DeepSeek（可扩展其他模型）
- **测试**：Vitest

---

## 📈 Roadmap

- v1.1：多 Agent 协作
- v1.2：插件市场在线分发 + 云端记忆
- v2.0：企业级私有部署 + MCP 深度集成

---

**DawnNew** —— 让 AI 真正学会自我进化。

**Star 支持一下** ⭐，欢迎 Issue 与 PR！

---

### 📜 授权与商用说明

- 本项目采用 MIT License，完全开源

-允许个人和商业使用，包括修改、二次开发、集成到商业产品中、分发等

-你可以免费使用 Dawn 核心功能，也可以基于它开发自己的产品或服务

-我们同时提供 Dawn Pro 付费订阅版（云端向量记忆、高级插件市场、优先计算资源、企业支持等），Pro 版为增值服务

-商用时无需额外授权，但请保留原作者署名和 MIT License 声明

