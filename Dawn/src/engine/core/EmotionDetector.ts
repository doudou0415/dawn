import type { EmotionResult } from '@dawn/core';

class EmotionDetector {
  private positiveKeywords = ['好', '棒', '赞', '谢谢', '厉害', '完美', '喜欢', '棒棒哒', '优秀', '出色'];
  private negativeKeywords = ['差', '烂', '糟糕', '失望', '生气', '愤怒', '烦躁', '讨厌', '无用', '垃圾'];
  private frustratedKeywords = ['不会', '不懂', '不行', '无法', '解决', '总是', '到底', '为什么', '怎么'];
  private excitedKeywords = ['太好了', '完美', '太棒了', '哇', '哇哦', '厉害', '牛', '强', '帅', '酷'];

  detect(text: string): EmotionResult {
    const lower = text.toLowerCase();
    let score = 0;
    let maxEmotion: 'positive' | 'neutral' | 'negative' | 'frustrated' | 'excited' = 'neutral';

    // 检查各类型关键词
    const positiveCount = this.positiveKeywords.filter(k => lower.includes(k)).length;
    const negativeCount = this.negativeKeywords.filter(k => lower.includes(k)).length;
    const frustratedCount = this.frustratedKeywords.filter(k => lower.includes(k)).length;
    const excitedCount = this.excitedKeywords.filter(k => lower.includes(k)).length;

    score = positiveCount - negativeCount - frustratedCount * 0.5;

    if (excitedCount > 0 && score > 0) {
      maxEmotion = 'excited';
    } else if (frustratedCount > positiveCount) {
      maxEmotion = 'frustrated';
    } else if (negativeCount > positiveCount) {
      maxEmotion = 'negative';
    } else if (positiveCount > 0) {
      maxEmotion = 'positive';
    }

    return {
      emotion: maxEmotion,
      intensity: Math.min(Math.abs(score) / 5, 1),
      confidence: positiveCount + negativeCount + frustratedCount + excitedCount > 0 ? 0.8 : 0.3
    };
  }
}

export { EmotionDetector };
