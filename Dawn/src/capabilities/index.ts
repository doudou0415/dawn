export { BrowserCapability, searchWeb, browse, shouldSearchWeb } from './atomic/browser/index.js';
export type { BrowserResult } from './atomic/browser/index.js';
export { FileOpsCapability } from './atomic/file/index.js';
export { CodeReviewCapability, CodeReviewEngine } from './atomic/codereview/index.js';
export type { CodeIssue } from './atomic/codereview/index.js';
// 复合能力
export { ChatCapability, FullStackDevCapability } from './composite/index.js';
// 注册中心
export { AtomicCapabilityRegistry } from './registry/index.js';
export type { AtomicCapability, CompositeCapability, CapabilityResult, AtomicInput } from './registry/types.js';
