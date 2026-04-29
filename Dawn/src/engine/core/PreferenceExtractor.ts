/**
 * PreferenceExtractor — 偏好记忆提取器（P2 重构：从 ExecutionLoop 提取）
 *
 * 负责：
 * - 从用户输入中自动提取偏好信息
 * - 规则匹配：记住 / 我喜欢 / 风格偏好
 * - 返回结构化的偏好键值对
 */

export interface PreferenceResult {
  key: string;
  value: string;
  type: 'user_preference' | 'code_style' | 'workflow';
}

export class PreferenceExtractor {
  /**
   * 从输入文本中提取偏好信息
   * 返回 null 表示未检测到偏好
   */
  extract(input: string): PreferenceResult | null {
    const t = input.trim();

    // "记住/请记住/记住我 ..."
    const rememberMatch = t.match(/^(请记住|记住我|记住)[：:，,\s]*(.+)/);
    if (rememberMatch) {
      const content = rememberMatch[2]!.trim();
      if (content && content.length > 2) {
        return { key: 'user_preference', value: content, type: 'user_preference' };
      }
    }

    // "我希望 / 我想要 / 我习惯 ..."
    const wishMatch = t.match(/^我(?:希望|想要|习惯|喜欢|偏好)[：:，,\s]*(.+)/);
    if (wishMatch) {
      const content = wishMatch[1]!.trim();
      if (content && content.length > 2 && !content.includes('什么') && !content.includes('吗')) {
        return { key: 'user_preference', value: `我${wishMatch[1]!.startsWith('喜欢') ? '' : '喜欢'}${content}`, type: 'user_preference' };
      }
    }

    // "以后都用 / 每次都用 / 默认用 ... 方式/风格"
    const defaultStyleMatch = t.match(/(?:以后都|每次都|默认)\s*用\s*(.+?)\s*(?:方式|风格|样式|做法|习惯)/);
    if (defaultStyleMatch) {
      return { key: 'workflow', value: defaultStyleMatch[1]!.trim(), type: 'workflow' };
    }

    // "用 XXX 风格/样式/方式"
    const styleMatch = t.match(/用\s*(.+?)\s*(?:风格|样式|方式)/);
    if (styleMatch) {
      return { key: 'code_style', value: styleMatch[1]!.trim(), type: 'code_style' };
    }

    // "不要用 XXX" / "别用 XXX"（否定偏好）
    const negStyleMatch = t.match(/(?:不要用|别用|不用)\s*(.+?)\s*(?:风格|样式|方式|做法)/);
    if (negStyleMatch) {
      return { key: 'code_style', value: `不${negStyleMatch[1]!.trim()}`, type: 'code_style' };
    }

    return null;
  }

  /**
   * 批量提取：从一段长文本中提取所有可能的偏好
   */
  extractAll(input: string): PreferenceResult[] {
    const results: PreferenceResult[] = [];
    const first = this.extract(input);
    if (first) results.push(first);

    // 按句子拆分检查更多偏好
    const sentences = input.split(/[。！？.!?\n]+/);
    for (const sentence of sentences) {
      const trimmed = sentence.trim();
      if (!trimmed) continue;
      const result = this.extract(trimmed);
      if (result && !results.some((r) => r.key === result.key && r.value === result.value)) {
        results.push(result);
      }
    }

    return results;
  }
}

/** 单例导出 */
export const preferenceExtractor = new PreferenceExtractor();
