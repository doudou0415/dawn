/**
 * experiments/ — A/B 测试管理
 *
 * 当前为骨架，后续可扩展：
 * - ABTestManager: 管理 A/B 测试的创建、运行、统计
 * - ExperimentReport: 实验结果报告生成
 * - HypothesisValidator: 假设验证
 */

export interface ABTestConfig {
  experimentId: string;
  name: string;
  description: string;
  variants: string[];
  trafficSplit: number[]; // 各变体流量占比，总和=1
  metrics: string[];      // 统计指标列表
  durationMs: number;
}

export interface ABTestResult {
  experimentId: string;
  variant: string;
  sampleSize: number;
  meanScore: number;
  stdDev: number;
  confidence: number;
}

// 骨架 — 后续 Phase 可按需实现
