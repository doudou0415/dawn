/**
 * Intent 类型定义 —— LLM + 规则混合意图解析用
 *
 * 支持多轮意图拆解、子意图、优先级标记。
 */

export interface Intent {
  name: string;
  confidence: number;
  parameters: Record<string, any>;
  /** 子意图列表（支持多轮拆解） */
  subIntents?: Intent[];
  /** 优先级 0-100 */
  priority?: number;
  /** 是否需要外部信息收集 */
  requiresInfoGathering?: boolean;
}
