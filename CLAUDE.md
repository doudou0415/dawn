# CLAUDE.md — Dawn 项目规范

## 项目概述
- 项目根目录：`D:\AI\DawnNew`
- 源码目录：`D:\AI\DawnNew\Dawn\src`
- 技术栈：Bun + TypeScript + ESM
- 包管理器：Bun

## 架构强制规范（不可违背）

1. **Orchestrator** 是唯一调度中枢，禁止绕过
2. **IntentEngine** 是唯一意图解析入口，禁止自建
3. **CapabilityRegistry** 统一能力注册路由，禁止硬编码
4. **ContextManager**（`src/memory/ContextManager.ts`）是三层记忆唯一入口
5. **AgentCore** 禁止硬编码路由、禁止自建意图识别
6. **SelfEvolutionEngine** 所有任务结束必须触发自进化分析

## 代码规范
- 4 空格缩进
- ESM 完整后缀导入（`.ts`/`.js`）
- 模块单一职责
- 修复原则：不删业务逻辑，只解耦补全，清理无效废弃依赖
- 后续开发优先级：架构对齐 > 模块解耦 > 功能迭代 > 性能优化
