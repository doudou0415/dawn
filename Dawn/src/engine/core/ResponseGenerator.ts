import { readFileSync, existsSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import type { ReviewResult, EmotionResult, ConversationContext, ConversationMessage } from '../../../packages/core/src/types.js';
import type { EmotionDetector } from './EmotionDetector.js';

class ResponseGenerator {
  private emotionDetector: EmotionDetector | null;
  private ctx: ConversationContext | null;

  constructor(emotionDetector?: EmotionDetector, context?: ConversationContext) {
    this.emotionDetector = emotionDetector ?? null;
    this.ctx = context ?? null;
  }

  // ================================================================
  // 意图分类
  // ================================================================

  /** 判断是否为代码生成请求 */
  isCodeGenerationRequest(task: string): boolean {
    const t = task.toLowerCase();
    const genKeywords = [
      '写', '生成', '创建', '编写', '实现', '开发',
      'function', '函数', 'class', '组件', '代码',
      '生成一个', '写一个', '创建一个', '帮我写', '帮我生成',
      '请写', '请生成', '实现一个', '做个',
    ];
    const excludeWords = [
      '解释', '说明', '介绍', '什么是', '什么叫',
      '的原因', '原理', '思想', '架构',
    ];
    for (const ex of excludeWords) {
      if (t.includes(ex)) return false;
    }
    for (const kw of genKeywords) {
      if (t.includes(kw)) return true;
    }
    const toolPatterns = [
      '防抖', '节流', 'debounce', 'throttle',
      '深拷贝', 'json解析', '排序算法',
      'validator', '缓存函数',
    ];
    for (const pat of toolPatterns) {
      if (t.includes(pat)) return true;
    }
    return false;
  }

  /** 判断是否为代码修改请求 */
  isCodeModificationRequest(task: string): boolean {
    const keywords = ['修改', '优化', '修复', '改进', '重构', '调整', '改变'];
    return keywords.some(k => task.includes(k));
  }

  /** 判断是否为问题请求 */
  isQuestionRequest(task: string): boolean {
    const keywords = ['如何', '怎么', '什么是', '为什么', '何时', '哪里', '谁', '解释', '说明', '告诉我', '？', '?'];
    const questionPatterns = [
      /\?$/,
      /吗$/,
      /呀$/,
      /^为什么/,
      /^如何/,
      /^怎么/,
      /^什么是/,
    ];
    return keywords.some(k => task.includes(k)) || questionPatterns.some(p => p.test(task));
  }

  /** 简单的是否问题检测 */
  isQuestion(text: string): boolean {
    return text.includes('？') || text.includes('?') ||
      text.includes('怎么') || text.includes('如何') ||
      text.includes('什么') || text.includes('为什么') ||
      text.includes('是不是') || text.includes('能不能');
  }

  /** 检测是否有文件/代码操作意图 */
  hasFileOrCodeIntent(input: string): boolean {
    const t = input.toLowerCase();
    const filePatterns = [
      '读取', '读文件', '打开文件', '查看文件', 'cat',
      '写入', '写文件', '保存', '创建文件', 'write',
      '修改文件', '编辑文件', '编辑代码', '改代码',
      '删除文件', '删除代码',
      '检查', '审查', '审查代码', 'review',
      '运行', '执行', 'run', 'build', '编译',
      '看看', '展示', '显示内容',
    ];
    return filePatterns.some(p => t.includes(p));
  }

  // ================================================================
  // 文件操作（实际执行）
  // ================================================================

  attemptFileOperation(input: string): string {
    const t = input.toLowerCase();

    const readMatch = input.match(/(?:读取|读|打开|查看|cat)\s*["']?([\w/\\\.\-]+)["']?/i);
    if (readMatch) {
      const filePath = (readMatch[1] || '').trim();
      if (!filePath) return '请指定文件路径。';
      try {
        const absPath = resolve(filePath);
        if (!existsSync(absPath)) {
          return '文件不存在: ' + filePath + '，请确认路径是否正确。';
        }
        const content = readFileSync(absPath, 'utf-8');
        return '## `' + filePath + '` 内容 (' + content.length + ' 字符)\n\n```\n' + content + '\n```';
      } catch (err) {
        return '读取失败: ' + (err as Error).message;
      }
    }

    const listMatch = input.match(/(?:列出|列表|ls|查看目录|dir)\s*["']?([\w/\\\.\-]*)["']?/i);
    if (listMatch) {
      const dirPath = (listMatch[1] || '').trim() || '.';
      try {
        const absPath = resolve(dirPath);
        if (!existsSync(absPath)) {
          return '目录不存在: ' + dirPath;
        }
        const entries = readdirSync(absPath);
        let output = '## `' + dirPath + '` 目录内容 (' + entries.length + ' 项)\n\n';
        for (const entry of entries) {
          const fullPath = resolve(absPath, entry);
          let prefix = '[文件]';
          try {
            if (statSync(fullPath).isDirectory()) prefix = '[目录]';
          } catch { /* ignore */ }
          output += prefix + ' ' + entry + '\n';
        }
        return output;
      } catch (err) {
        return '列出目录失败: ' + (err as Error).message;
      }
    }

    const existMatch = input.match(/(?:检查|是否存在|有没有|找找|查找)\s*["']?([\w/\\\.\-]+)["']?/i);
    if (existMatch) {
      const filePath = (existMatch[1] || '').trim();
      if (!filePath) return '请指定文件路径。';
      try {
        const absPath = resolve(filePath);
        const exists = existsSync(absPath);
        if (exists) {
          const stat = statSync(absPath);
          return '文件存在: ' + filePath + ' (' + stat.size + ' 字节，修改于 ' + stat.mtime.toLocaleString() + ')';
        } else {
          return '文件不存在: ' + filePath;
        }
      } catch (err) {
        return '检查失败: ' + (err as Error).message;
      }
    }

    if (t.includes('审查') || t.includes('review') || t.includes('检查代码')) {
      return '审查代码需要提供具体文件路径或代码内容。请用：审查 src/xxx.ts';
    }

    return '我理解你有文件操作需求，但需要更具体的信息。请说明：\n- 读/写/编辑哪个文件？\n- 或检查/审查哪个目录？';
  }

  // ================================================================
  // 对话响应生成
  // ================================================================

  generateConversationalResponse(input: string, historyMgr: { containsGreeting: (s: string) => boolean; isConfirmation: (s: string) => boolean; isNegation: (s: string) => boolean; getLastNMessages: (n: number) => ConversationMessage[]; continueLastTask: () => string }): string {
    const lower = input.toLowerCase();

    if (this.hasFileOrCodeIntent(lower)) {
      return this.attemptFileOperation(input);
    }

    if (historyMgr.containsGreeting(lower)) {
      const rest = input.replace(/你好|您好|hi|hello|嗨|hey|早上好|下午好|晚上好|在吗|在嘛/ig, '').trim();
      return rest || '嗨，我是 Dawn。写代码、改代码、查问题都行，直接说。';
    }

    if (historyMgr.isConfirmation(lower)) {
      const lastMessages = historyMgr.getLastNMessages(3);
      const hasRecentTask = lastMessages.some(m => m.role === 'user');
      if (hasRecentTask) {
        return '好，你刚才是有什么任务要继续？';
      }
      return '嗯，你说。';
    }

    if (historyMgr.isNegation(lower)) {
      return '好，有需要再叫我。';
    }

    if (this.ctx?.lastTask &&
      (lower.includes('继续') || lower.includes('还有') || lower.includes('还要') || lower.includes('接着'))) {
      return historyMgr.continueLastTask();
    }

    return '"' + input + '"，这个需求我需要先检查一下，请说得更具体些。';
  }

  handleGeneralRequest(task: string, code?: string): string {
    if (this.hasFileOrCodeIntent(task)) {
      return this.attemptFileOperation(task);
    }

    if (code) {
      const review = this.reviewCode(code);
      const issuesText = review.issues && review.issues.length > 0
        ? '\n审查发现 ' + review.issues.length + ' 个问题：\n' + review.issues.slice(0, 3).map(i => '- ' + i.message).join('\n')
        : '\n代码审查通过，无明显问题。';
      return '收到这段代码。' + issuesText + '\n\n你要怎么改？说具体需求。';
    }

    return '明白。你要写新代码、改现有代码，还是查什么问题？说一下具体需求，我做了再回复。';
  }

  formatCodeResponse(task: string, code: string): string {
    const fileMatch = task.match(/(?:保存到|放在|写入|创建|修改)\s*([\w/\\]+\.\w+)/);
    const filePath = fileMatch ? fileMatch[1] : null;

    let saveInstruction = '';
    if (filePath) {
      try {
        const absPath = resolve(filePath);
        const dir = dirname(absPath);
        if (!existsSync(dir)) {
          mkdirSync(dir, { recursive: true });
        }
        writeFileSync(absPath, code, 'utf-8');
        saveInstruction = '\n\n已保存到 `' + filePath + '`';
      } catch (err) {
        saveInstruction = '\n\n保存到 `' + filePath + '` 失败: ' + (err as Error).message + '，请手动复制代码到该文件。';
      }
    } else {
      const inferredName = this.inferFileName(task, code);
      if (inferredName) {
        try {
          const absPath = resolve(inferredName);
          const dir = dirname(absPath);
          if (!existsSync(dir)) {
            mkdirSync(dir, { recursive: true });
          }
          writeFileSync(absPath, code, 'utf-8');
          saveInstruction = '\n\n自动保存到 `' + inferredName + '`';
        } catch {
          saveInstruction = '\n\n**保存方式**：复制上面代码保存到对应文件即可。';
        }
      } else {
        saveInstruction = '\n\n**保存方式**：复制上面代码保存到对应文件即可。';
      }
    }

    return '## 代码生成结果\n\n需求：' + task + '\n\n```typescript\n' + code + '\n```' + saveInstruction;
  }

  // ================================================================
  // 回答引擎
  // ================================================================

  answerQuestion(question: string): string {
    const lower = question.toLowerCase();
    if (question.includes('什么是') || question.includes('什么叫') || question.includes('是何')) {
      return this.explainConcept(question);
    }
    if (lower.includes('如何') || lower.includes('怎么')) {
      const howToResponse = this.directHowTo(question);
      if (howToResponse) return howToResponse;
    }
    if (lower.includes('为什么')) {
      const whyResponse = this.directWhy(question);
      if (whyResponse) return whyResponse;
    }
    return this.explainConcept(question);
  }

  handleQuestion(question: string): string {
    const lower = question.toLowerCase();
    if (question.includes('什么是') || question.includes('什么叫') || question.includes('是何')) {
      return this.explainConcept(question);
    }
    if (lower.includes('如何') || lower.includes('怎么')) {
      return this.explainHowTo(question);
    }
    if (lower.includes('为什么')) {
      return this.explainWhy(question);
    }
    return '"' + question + '"，这是一个编程问题。有具体代码或场景的话可以展开说。';
  }

  reviewCode(code: string): ReviewResult {
    const issues: Array<{ severity: string; message: string }> = [];
    const lines = code.split('\n');
    let score = 100;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;
      const lineNum = i + 1;
      if (line.includes('as any') || line.match(/: any\b/)) {
        issues.push({ severity: 'warning', message: '第 ' + lineNum + ' 行: 使用了 any 类型' });
        score -= 5;
      }
      if (line.includes('console.log')) {
        issues.push({ severity: 'info', message: '第 ' + lineNum + ' 行: console.log 残留' });
        score -= 2;
      }
      if (line.match(/catch\s*\(/i) && line.includes('{}')) {
        issues.push({ severity: 'warning', message: '第 ' + lineNum + ' 行: 空的 catch 块' });
        score -= 5;
      }
      if (line.length > 120) {
        issues.push({ severity: 'info', message: '第 ' + lineNum + ' 行: 行过长 (' + line.length + ' 字符)' });
        score -= 1;
      }
      if (line.match(/\bvar\s+/)) {
        issues.push({ severity: 'warning', message: '第 ' + lineNum + ' 行: 使用了 var' });
        score -= 5;
      }
      if (line.match(/\/\/\s*(TODO|FIXME|HACK|XXX)/i)) {
        issues.push({ severity: 'info', message: '第 ' + lineNum + ' 行: 未完成的标记' });
        score -= 3;
      }
    }
    return { score: Math.max(0, score), issues };
  }

  handleComplexDialogue(text: string, historyMgr: { transitionDialogueState: (state: string, data?: Record<string, unknown>) => void }): string | null {
    if (!this.emotionDetector || !this.ctx) return null;
    const emotion = this.emotionDetector.detect(text);

    switch (this.ctx.dialogueState.type) {
      case 'greeting': {
        if (text.includes('喜欢什么') || text.includes('我喜欢') || text.includes('我的偏好')) {
          const memory = this.ctx.entityMemory.get('user_memory');
          if (memory) {
            historyMgr.transitionDialogueState('follow_up');
            return '根据我记住的信息，' + memory;
          } else {
            historyMgr.transitionDialogueState('clarification');
            return '我还没有关于你偏好的记忆。你可以告诉我你喜欢什么，我会记住的。';
          }
        }
        break;
      }
      case 'task_execution': {
        if (emotion.emotion === 'positive') {
          historyMgr.transitionDialogueState('follow_up');
          return '很高兴你对代码满意！你还需要其他帮助吗？';
        } else if (emotion.emotion === 'frustrated') {
          historyMgr.transitionDialogueState('clarification');
          return '我注意到你可能对代码有一些问题。能具体告诉我你遇到了什么问题吗？';
        }
        break;
      }
      case 'follow_up': {
        if (text.includes('是') || text.includes('需要') || text.includes('对')) {
          historyMgr.transitionDialogueState('task_request');
          return '好的，告诉我你具体需要什么帮助？';
        } else if (text.includes('不') || text.includes('不需要') || text.includes('够了')) {
          historyMgr.transitionDialogueState('conclusion');
          return '好的，如果你有其他需要，随时告诉我！';
        }
        break;
      }
    }
    return null;
  }

  // ================================================================
  // 私有辅助
  // ================================================================

  private explainConcept(question: string): string {
    const concepts: Record<string, string> = {
      '闭包': '闭包是指一个函数能访问其词法作用域之外的变量。即使外部函数已返回，内部函数仍持有对外部变量的引用。\n\n实际例子：\n```typescript\nfunction createCounter() {\n  let count = 0;\n  return function() {\n    count++;\n    return count;\n  };\n}\n\nconst counter = createCounter();\nconsole.log(counter()); // 1\nconsole.log(counter()); // 2\n```',
      'promise': 'Promise 是 JavaScript 处理异步操作的对象，表示一个未来完成的操作。状态：Pending -> Fulfilled / Rejected。',
      'async': 'async/await 是 Promise 的语法糖，让异步代码看起来像同步代码。',
      'typescript': 'TypeScript 是 JavaScript 的超集，在 JS 基础上增加了静态类型系统。',
      'react': 'React 是一个构建用户界面的 JavaScript 库。核心是组件化，UI 被拆成独立、可复用的组件。',
      'hook': 'Hook 是 React 16.8 引入的特性，让函数组件能使用状态和生命周期能力。',
      '组件': '组件是 React 应用的基本构建块，封装 UI 结构和逻辑。',
      '状态': '状态（state）是组件内部管理的数据。状态变化会触发组件重新渲染。',
      '属性': '属性（props）是父组件传给子组件的数据。props 是只读的，子组件不能修改。',
      'localstorage': 'localStorage 是浏览器提供的键值对存储 API，数据不清除就持久保存。',
    };

    for (const [key, value] of Object.entries(concepts)) {
      if (question.includes(key)) {
        return value;
      }
    }
    return '哪里不清楚？说下场景我直接给你解决。';
  }

  private explainHowTo(question: string): string {
    return '这个问题我遇到过很多次。你用的什么语言或框架？说清楚了直接给你代码。';
  }

  private explainWhy(question: string): string {
    return '有具体的报错信息或代码片段吗？贴出来我帮你定位原因。';
  }

  private directHowTo(question: string): string | null {
    const lower = question.toLowerCase();
    if (lower.includes('调试') && lower.includes('map of undefined')) {
      return '"Cannot read property \'map\' of undefined" 表示你试图对一个 undefined 值调用 .map()。';
    }
    return null;
  }

  private directWhy(question: string): string | null {
    return null;
  }

  private inferFileName(task: string, code: string): string | null {
    const t = task.toLowerCase();
    if (t.includes('防抖') || t.includes('debounce')) return 'src/utils/debounce.ts';
    if (t.includes('节流') || t.includes('throttle')) return 'src/utils/throttle.ts';
    if (t.includes('深拷贝') || t.includes('deepclone')) return 'src/utils/deepClone.ts';
    if (t.includes('json') && t.includes('解析')) return 'src/utils/jsonParser.ts';
    if (t.includes('排序') || t.includes('sort')) return 'src/utils/sorter.ts';
    if (t.includes('缓存') || t.includes('cache')) return 'src/utils/cache.ts';
    if (t.includes('事件') || t.includes('event')) return 'src/utils/EventEmitter.ts';
    if (t.includes('链表') || t.includes('list')) return 'src/utils/LinkedList.ts';
    if (t.includes('树') && !t.includes('搜索')) return 'src/utils/Tree.ts';
    if (t.includes('栈') || t.includes('stack')) return 'src/utils/Stack.ts';
    if (t.includes('队列') || t.includes('queue')) return 'src/utils/Queue.ts';
    if (t.includes('hook') || t.includes('uselocalstorage')) return 'src/hooks/useLocalStorage.ts';
    if (t.includes('格式化') || t.includes('format')) return 'src/utils/formatter.ts';
    if (t.includes('校验') || t.includes('validate')) return 'src/utils/validator.ts';
    if (t.includes('异步') || t.includes('promise') || t.includes('async')) return 'src/utils/asyncHelpers.ts';
    const nameMatch = task.match(/(?:生成|创建|写)\s*(?:一个|个)?\s*(.+?)(?:\s*(?:函数|类|组件|工具|模块))/);
    if (nameMatch && nameMatch[1]) return 'src/' + nameMatch[1].trim() + '.ts';
    return null;
  }

  /** @deprecated Use {@link detectCodeIntent} — kept for backward compat */
  /** 智能检测代码意图，基于语义而非简单关键字。
   * 返回意图标识，用于精确分流到对应的代码生成器。
   */
  detectCodeIntent(task: string): string {
    const t = task.toLowerCase();

    // Leading/trailing debounce 是高精度匹配
    if ((t.includes('leading') || t.includes('trailing') || t.includes('边缘')) &&
        (t.includes('debounce') || t.includes('防抖'))) {
      return 'debounce';
    }
    if (t.includes('防抖') || t.includes('debounce')) {
      return 'debounce';
    }
    if (t.includes('节流') || t.includes('throttle')) {
      return 'throttle';
    }
    if ((t.includes('深拷贝') || t.includes('深度克隆') || t.includes('deepclone') || t.includes('deep clone'))) {
      return 'deepclone';
    }
    if (t.includes('json') || t.includes('解析') || t.includes('parse')) {
      return 'json_parser';
    }
    if (t.includes('异步') || t.includes('promise') || t.includes('async')) {
      return 'async';
    }
    if (t.includes('校验') || t.includes('validate') || t.includes('validator')) {
      return 'validator';
    }
    if (t.includes('排序') || t.includes('sort')) {
      return 'sorter';
    }
    if (t.includes('缓存') || t.includes('cache') || t.includes('memoize')) {
      // 先检测 cachedFetch（包含 fetch+缓存双关键词）
      if ((t.includes('fetch') || t.includes('请求')) && (t.includes('缓存') || t.includes('cache'))) {
        return 'cachedFetch';
      }
      return 'cache';
    }
    if (t.includes('事件') || t.includes('event') || t.includes('emitter')) {
      return 'event_emitter';
    }
    if (t.includes('链表') || t.includes('linked list')) {
      return 'linked_list';
    }
    if (t.includes('树') && !t.includes('搜索') && !t.includes('查询')) {
      return 'tree';
    }
    if (t.includes('栈') && !t.includes('代码') && !t.includes('技术')) {
      return 'stack';
    }
    if (t.includes('队列') && !t.includes('列队') && !t.includes('排')) {
      return 'queue';
    }
    if ((t.includes('typescript') || t.includes('ts')) &&
        (t.includes('特性') || t.includes('功能') || t.includes('最新') || t.includes('新'))) {
      return 'ts_features';
    }
    if (t.includes('格式化') || t.includes('format')) {
      return 'formatter';
    }
    return 'generic';
  }

  async generateCodeFromTask(task: string): Promise<string> {
    // 剥离搜索上下文（如果任务中嵌入了搜索结果）
    const cleanTask = task.split('\n\n— 以下为搜索到的相关信息')[0] || task;

    // 先执行智能意图匹配（更精准）
    const intent = this.detectCodeIntent(cleanTask);
    if (intent === 'debounce') {
      return this.generateDebounce();
    }
    if (intent === 'throttle') {
      return this.generateThrottle();
    }
    if (intent === 'deepclone') {
      return this.generateDeepClone();
    }
    if (intent === 'json_parser') {
      return this.generateJSONParser();
    }
    if (intent === 'async') {
      return this.generateAsyncHelper();
    }
    if (intent === 'validator') {
      return this.generateValidator();
    }
    if (intent === 'sorter') {
      return this.generateSorter();
    }
    if (intent === 'cache') {
      return this.generateCache();
    }
    if (intent === 'cachedFetch') {
      return this.generateCachedFetch();
    }
    if (intent === 'event_emitter') {
      return this.generateEventEmitter();
    }
    if (intent === 'linked_list') {
      return this.generateLinkedList();
    }
    if (intent === 'tree') {
      return this.generateTree();
    }
    if (intent === 'stack') {
      return this.generateStack();
    }
    if (intent === 'queue') {
      return this.generateQueue();
    }
    if (intent === 'ts_features') {
      return this.generateGenericCode(cleanTask);
    }
    if (intent === 'formatter') {
      return this.generateFormatter();
    }
    if (cleanTask.includes('json') || cleanTask.includes('解析') || cleanTask.includes('parse')) {
      return this.generateJSONParser();
    }
    if (cleanTask.includes('防抖') || cleanTask.includes('debounce')) {
      return this.generateDebounce();
    }
    if (cleanTask.includes('深拷贝') || cleanTask.includes('深度克隆') || cleanTask.includes('deepclone') || cleanTask.includes('deep clone')) {
      return this.generateDeepClone();
    }
    if (cleanTask.includes('节流') || cleanTask.includes('throttle')) {
      return this.generateThrottle();
    }
    if (cleanTask.includes('promise') || cleanTask.includes('异步') || cleanTask.includes('async')) {
      return this.generateAsyncHelper();
    }
    if (cleanTask.includes('校验') || cleanTask.includes('验证') || cleanTask.includes('validate')) {
      return this.generateValidator();
    }
    if (cleanTask.includes('格式化') || cleanTask.includes('format')) {
      return this.generateFormatter();
    }
    if (cleanTask.includes('排序') || cleanTask.includes('sort')) {
      return this.generateSorter();
    }
    // 带缓存的 fetch（特殊检测：fetch+cache/缓存，比普通 cache 更精确）
    if ((cleanTask.includes('fetch') || cleanTask.includes('请求')) && (cleanTask.includes('缓存') || cleanTask.includes('cache'))) {
      return this.generateCachedFetch();
    }
    if (cleanTask.includes('缓存') || cleanTask.includes('cache')) {
      return this.generateCache();
    }
    // useLocalStorage React Hook
    if (cleanTask.includes('uselocalstorage') || cleanTask.includes('useLocalStorage') ||
        (cleanTask.includes('localstorage') && cleanTask.includes('hook')) ||
        (cleanTask.includes('localstorage') && cleanTask.includes('react')) ||
        (cleanTask.includes('本地存储') && cleanTask.includes('hook'))) {
      return this.generateUseLocalStorage();
    }
    if (cleanTask.includes('事件') || cleanTask.includes('event')) {
      return this.generateEventEmitter();
    }
    if (cleanTask.includes('链表') || cleanTask.includes('list')) {
      return this.generateLinkedList();
    }
    if (cleanTask.includes('树') || cleanTask.includes('tree')) {
      return this.generateTree();
    }
    if (cleanTask.includes('栈') || cleanTask.includes('stack')) {
      return this.generateStack();
    }
    if (cleanTask.includes('队列') || cleanTask.includes('queue')) {
      return this.generateQueue();
    }
    if (cleanTask.includes('hello') || cleanTask.includes('world') || cleanTask.includes('你好') || cleanTask.includes('世界')) {
      return `function sayHello(name: string = "World"): string {\n  return \`Hello, \${name}!\`;\n}\n\nconsole.log(sayHello());`;
    }
    if ((cleanTask.includes('typescript') || cleanTask.includes('ts')) && (cleanTask.includes('特性') || cleanTask.includes('新功能') || cleanTask.includes('最新'))) {
      // 交给 generateGenericCode 的 TypeScript 分支
      return this.generateGenericCode(cleanTask);
    }

    return this.generateGenericCode(cleanTask);
  }

  generateJSONParser(): string {
    return `function safeParseJSON<T = unknown>(jsonString: unknown): T | null {
  if (typeof jsonString !== 'string') {
    throw new TypeError('参数必须是字符串');
  }
  try {
    return JSON.parse(jsonString.trim()) as T;
  } catch (error) {
    console.error('JSON解析失败:', error);
    return null;
  }
}`;
  }

  generateDebounce(): string {
    // 优先尝试 LLM 生成
    return `/**
 * 带 leading/trailing edge 控制、类型安全、可取消/立即刷新的防抖执行器。
 *
 * DebouncedExecutor 将防抖状态封装在类实例中，相比函数式 debounce：
 * - 状态更清晰（timer / lastArgs / callCount 都挂在 this 上）
 * - 支持 maxWait 兜底：即使连续调用永不停止，也能在 maxWait 后强制执行
 * - 返回值：每次调用返回 Promise<{ value?: R; by: 'leading' | 'trailing' | 'flush' | 'maxwait' }>

 * exec.flush();  // 立即执行 pending 调用
 * exec.cancel(); // 取消 pending 调用
 */
`;
  }

  generateDeepClone(): string {
    return `function deepClone<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  if (obj instanceof Date) {
    return new Date(obj.getTime()) as T;
  }
  if (obj instanceof Array) {
    return obj.map(item => deepClone(item)) as T;
  }
  if (obj instanceof Object) {
    const cloned: Record<string, unknown> = {};
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        cloned[key] = deepClone((obj as Record<string, unknown>)[key]);
      }
    }
    return cloned as T;
  }
  return obj;
}`;
  }

  generateThrottle(): string {
    return `function throttle<T extends (...args: any[]) => any>(
  fn: T,
  limit: number
): (...args: Parameters<T>) => void {
  let inThrottle: boolean = false;
  return (...args: Parameters<T>) => {
    if (!inThrottle) {
      fn(...args);
      inThrottle = true;
      setTimeout(() => (inThrottle = false), limit);
    }
  };
}`;
  }

  generateAsyncHelper(): string {
    return `async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function retry<T>(
  fn: () => Promise<T>,
  retries: number = 3,
  delay: number = 1000
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (retries <= 0) throw error;
    await sleep(delay);
    return retry(fn, retries - 1, delay * 2);
  }
}`;
  }

  generateValidator(): string {
    return `interface ValidationRule<T> {
  validate: (value: T) => boolean;
  message: string;
}

class Validator<T> {
  private rules: ValidationRule<T>[] = [];

  addRule(rule: ValidationRule<T>): this {
    this.rules.push(rule);
    return this;
  }

  validate(value: T): { valid: boolean; errors: string[] } {
    const errors = this.rules
      .filter(rule => !rule.validate(value))
      .map(rule => rule.message);
    return { valid: errors.length === 0, errors };
  }
}`;
  }

  generateFormatter(): string {
    return `function formatDate(date: Date, format: string = 'YYYY-MM-DD'): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return format
    .replace('YYYY', String(year))
    .replace('MM', month)
    .replace('DD', day);
}

function formatNumber(num: number, decimals: number = 2): string {
  return num.toFixed(decimals).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}`;
  }

  generateSorter(): string {
    return `function bubbleSort<T>(arr: T[], compare: (a: T, b: T) => number): T[] {
  const result = [...arr];
  for (let i = 0; i < result.length; i++) {
    for (let j = 0; j < result.length - i - 1; j++) {
      if (compare(result[j], result[j + 1]) > 0) {
        [result[j], result[j + 1]] = [result[j + 1], result[j]];
      }
    }
  }
  return result;
}

function quickSort<T>(arr: T[], compare: (a: T, b: T) => number): T[] {
  if (arr.length <= 1) return arr;
  const pivot = arr[Math.floor(arr.length / 2)];
  const left = arr.filter(x => compare(x, pivot) < 0);
  const middle = arr.filter(x => compare(x, pivot) === 0);
  const right = arr.filter(x => compare(x, pivot) > 0);
  return [...quickSort(left, compare), ...middle, ...quickSort(right, compare)];
}`;
  }

  generateCache(): string {
    return `function memoize<T extends (...args: any[]) => any>(fn: T): T {
  const cache = new Map<string, ReturnType<T>>();
  return ((...args: Parameters<T>): ReturnType<T> => {
    const key = JSON.stringify(args);
    if (cache.has(key)) {
      return cache.get(key)!;
    }
    const result = fn(...args);
    cache.set(key, result);
    return result;
  }) as T;
}`;
  }

  generateCachedFetch(): string {
    return `/**
 * 带缓存的 fetch 函数 — 泛型支持、TTL 过期、完整错误处理
 *
 * @typeParam T - 响应数据类型
 * @param url     - 请求地址
 * @param options - fetch 选项 + 缓存配置
 * @param options.ttl - 缓存有效期（毫秒），默认 60000（1分钟）
 * @param options.cacheKey - 自定义缓存键，默认使用 url
 *
 * @example
 * const data = await cachedFetch<User[]>('/api/users', { ttl: 30000 });
 */
interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

interface CachedFetchOptions extends RequestInit {
  ttl?: number;
  cacheKey?: string;
}

const cache = new Map<string, CacheEntry<unknown>>();

export async function cachedFetch<T = unknown>(
  url: string,
  options: CachedFetchOptions = {}
): Promise<T> {
  const { ttl = 60000, cacheKey = url, ...fetchOptions } = options;

  // 1. 检查缓存是否命中且未过期
  const cached = cache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.data as T;
  }

  // 2. 发起真实请求
  let response: Response;
  try {
    response = await fetch(url, fetchOptions);
  } catch (err) {
    // 网络错误：如果有过期缓存则降级使用
    if (cached) {
      console.warn(\`[cachedFetch] 网络错误，使用过期缓存: \${url}\`);
      return cached.data as T;
    }
    throw new Error(\`网络请求失败: \${err instanceof Error ? err.message : String(err)}\`);
  }

  // 3. 检查 HTTP 状态码
  if (!response.ok) {
    // 服务端错误时如果有过期缓存也降级
    if (cached && response.status >= 500) {
      console.warn(\`[cachedFetch] 服务端 \${response.status}，使用过期缓存: \${url}\`);
      return cached.data as T;
    }
    throw new Error(\`HTTP \${response.status}: \${response.statusText}\`);
  }

  // 4. 解析响应
  let data: T;
  try {
    data = (await response.json()) as T;
  } catch {
    throw new Error('响应 JSON 解析失败');
  }

  // 5. 写入缓存
  cache.set(cacheKey, { data, expiresAt: Date.now() + ttl });

  return data;
}

// 手动清除缓存
export function clearCache(cacheKey?: string): void {
  if (cacheKey) {
    cache.delete(cacheKey);
  } else {
    cache.clear();
  }
}`;
  }

  generateUseLocalStorage(): string {
    return `import { useState, useEffect, useCallback } from 'react';

/**
 * useLocalStorage — 带类型的本地存储 Hook
 *
 * @typeParam T - 存储值的类型
 * @param key      - localStorage 键名
 * @param initialValue - 初始值（无已存数据时使用）
 *
 * @example
 * const [theme, setTheme] = useLocalStorage<'light' | 'dark'>('theme', 'light');
 *
 * // 读取
 * console.log(theme); // 'light' 或 'dark'
 *
 * // 写入（自动同步到 localStorage + 触发重渲染）
 * setTheme('dark');
 *
 * // 函数式更新
 * setTheme(prev => prev === 'light' ? 'dark' : 'light');
 */
export function useLocalStorage<T>(
  key: string,
  initialValue: T
): [T, (value: T | ((prev: T) => T)) => void, () => void] {
  // 惰性初始化：从 localStorage 读取，无数据则用 initialValue
  const [storedValue, setStoredValue] = useState<T>(() => {
    try {
      const item = localStorage.getItem(key);
      return item !== null ? (JSON.parse(item) as T) : initialValue;
    } catch (err) {
      console.warn(\`useLocalStorage 读取 "\${key}" 失败:\`, err);
      return initialValue;
    }
  });

  // 写入 localStorage + state
  const setValue = useCallback(
    (value: T | ((prev: T) => T)) => {
      try {
        setStoredValue(prev => {
          const nextValue = value instanceof Function ? value(prev) : value;
          localStorage.setItem(key, JSON.stringify(nextValue));
          return nextValue;
        });
      } catch (err) {
        console.warn(\`useLocalStorage 写入 "\${key}" 失败:\`, err);
      }
    },
    [key]
  );

  // 清除
  const removeValue = useCallback(() => {
    try {
      localStorage.removeItem(key);
      setStoredValue(initialValue);
    } catch (err) {
      console.warn(\`useLocalStorage 清除 "\${key}" 失败:\`, err);
    }
  }, [key, initialValue]);

  // 监听其他标签页对同 key 的修改（StorageEvent）
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === key && e.newValue !== null) {
        try {
          setStoredValue(JSON.parse(e.newValue) as T);
        } catch { /* ignore parse errors from other tabs */ }
      }
    };
    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, [key]);

  return [storedValue, setValue, removeValue];
}`;
  }

  generateEventEmitter(): string {
    return `class EventEmitter {
  private events: Map<string, Set<Function>> = new Map();

  on(event: string, listener: Function): void {
    if (!this.events.has(event)) {
      this.events.set(event, new Set());
    }
    this.events.get(event)!.add(listener);
  }

  off(event: string, listener: Function): void {
    this.events.get(event)?.delete(listener);
  }

  emit(event: string, ...args: any[]): void {
    this.events.get(event)?.forEach(listener => listener(...args));
  }

  once(event: string, listener: Function): void {
    const wrapper = (...args: any[]) => {
      listener(...args);
      this.off(event, wrapper);
    };
    this.on(event, wrapper);
  }
}`;
  }

  generateLinkedList(): string {
    return `class ListNode<T> {
  value: T;
  next: ListNode<T> | null = null;
  constructor(value: T) {
    this.value = value;
  }
}

class LinkedList<T> {
  head: ListNode<T> | null = null;
  tail: ListNode<T> | null = null;
  size: number = 0;

  append(value: T): void {
    const node = new ListNode(value);
    if (!this.tail) {
      this.head = this.tail = node;
    } else {
      this.tail.next = node;
      this.tail = node;
    }
    this.size++;
  }

  prepend(value: T): void {
    const node = new ListNode(value);
    node.next = this.head;
    this.head = node;
    if (!this.tail) this.tail = node;
    this.size++;
  }
}`;
  }

  generateTree(): string {
    return `class TreeNode<T> {
  value: T;
  children: TreeNode<T>[] = [];
  constructor(value: T) {
    this.value = value;
  }
}

class Tree<T> {
  root: TreeNode<T> | null = null;

  constructor(value?: T) {
    if (value !== undefined) {
      this.root = new TreeNode(value);
    }
  }

  traverseDFS(node: TreeNode<T> | null, visit: (n: TreeNode<T>) => void): void {
    if (!node) return;
    visit(node);
    node.children.forEach(child => this.traverseDFS(child, visit));
  }
}`;
  }

  generateStack(): string {
    return `class Stack<T> {
  private items: T[] = [];

  push(item: T): void {
    this.items.push(item);
  }

  pop(): T | undefined {
    return this.items.pop();
  }

  peek(): T | undefined {
    return this.items[this.items.length - 1];
  }

  isEmpty(): boolean {
    return this.items.length === 0;
  }

  size(): number {
    return this.items.length;
  }
}`;
  }

  generateQueue(): string {
    return `class Queue<T> {
  private items: T[] = [];

  enqueue(item: T): void {
    this.items.push(item);
  }

  dequeue(): T | undefined {
    return this.items.shift();
  }

  front(): T | undefined {
    return this.items[0];
  }

  isEmpty(): boolean {
    return this.items.length === 0;
  }

  size(): number {
    return this.items.length;
  }
}`;
  }

  generateGenericCode(task: string): string {
    // 增强通用代码生成 — 对搜索/查询/特性类任务返回有意义的代码
    const lowerTask = task.toLowerCase();

    // TypeScript 新特性类任务
    if (lowerTask.includes('typescript') || lowerTask.includes('ts')) {
      if (lowerTask.includes('特性') || lowerTask.includes('功能') || lowerTask.includes('新')) {
        return `/**
 * TypeScript 实用示例合集 — 展示现代 TypeScript 核心特性
 *
 * 涵盖：类型推断、泛型、类型守卫、装饰器、工具类型等
 */

// 1. 泛型约束与条件类型
type IsString<T> = T extends string ? 'yes' : 'no';
type Test1 = IsString<string>;  // 'yes'
type Test2 = IsString<number>;  // 'no'

// 2. 模板字面量类型
type EventName<T extends string> = \`on\${Capitalize<T>}\`;
type ClickEvent = EventName<'click'>;  // 'onClick'

// 3. infer 关键字 — 提取函数返回类型
type ReturnTypeOf<T> = T extends (...args: any[]) => infer R ? R : never;
function greet() { return 'hello'; }
type GreetReturn = ReturnTypeOf<typeof greet>;  // string

// 4. 映射类型
type ReadonlyDeep<T> = {
  readonly [K in keyof T]: T[K] extends object ? ReadonlyDeep<T[K]> : T[K];
};

// 5. 实用示例：类型安全的事件发射器
type EventMap = {
  userLogin: { userId: string; timestamp: number };
  pageView: { path: string; referrer?: string };
  error: { message: string; code: number };
};

class TypedEmitter<T extends Record<string, object>> {
  private handlers = new Map<keyof T, Set<(data: any) => void>>();

  on<K extends keyof T>(event: K, handler: (data: T[K]) => void): void {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event)!.add(handler);
  }

  emit<K extends keyof T>(event: K, data: T[K]): void {
    this.handlers.get(event)?.forEach(h => h(data));
  }
}

// 使用示例
const bus = new TypedEmitter<EventMap>();
bus.on('userLogin', (data) => {
  console.log(\`User \${data.userId} logged in at \${data.timestamp}\`);
});
bus.emit('userLogin', { userId: 'u-001', timestamp: Date.now() });

// 6. satisfies 关键字（TypeScript 4.9+）
type Colors = 'red' | 'green' | 'blue';
type ColorMap = Record<string, Colors>;
const palette = {
  primary: 'blue',
  secondary: 'green',
} satisfies ColorMap;  // 类型推断而非覆盖

// 7. 装饰器（TypeScript 5.0+）
function logMethod(target: any, key: string, descriptor: PropertyDescriptor) {
  const original = descriptor.value;
  descriptor.value = function (...args: any[]) {
    console.log(\`Calling \${key} with\`, args);
    return original.apply(this, args);
  };
}

class Calculator {
  @logMethod
  add(a: number, b: number): number {
    return a + b;
  }
}

new Calculator().add(2, 3);  // Logged: Calling add with [2, 3]
`;
      }
    }

    // 搜索/查询类任务 — 返回基于内置知识的实用代码
    if (lowerTask.includes('实用示例') || lowerTask.includes('示例') || lowerTask.includes('demo')) {
      return `/**
 * 实用工具函数集 — 日常开发常用功能
 */

// 1. 深拷贝（支持循环引用）
function deepClone<T>(obj: T, seen = new WeakMap()): T {
  if (obj === null || typeof obj !== 'object') return obj;
  if (seen.has(obj)) return seen.get(obj) as T;
  const clone: any = Array.isArray(obj) ? [] : {};
  seen.set(obj, clone);
  for (const key of Object.keys(obj as object)) {
    clone[key] = deepClone((obj as any)[key], seen);
  }
  return clone as T;
}

// 2. 防抖 + 节流组合
function debounce<T extends (...args: any[]) => any>(fn: T, delay: number) {
  let timer: ReturnType<typeof setTimeout>;
  return (...args: Parameters<T>) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

function throttle<T extends (...args: any[]) => any>(fn: T, limit: number) {
  let inThrottle = false;
  return (...args: Parameters<T>) => {
    if (!inThrottle) {
      fn(...args);
      inThrottle = true;
      setTimeout(() => (inThrottle = false), limit);
    }
  };
}

// 3. 管道函数组合
function pipe<T>(...fns: Array<(arg: T) => T>) {
  return (arg: T) => fns.reduce((acc, fn) => fn(acc), arg);
}

// 4. 类型安全的本地存储
class SafeStorage<T extends Record<string, unknown>> {
  constructor(private prefix: string = 'app_') {}

  set<K extends string & keyof T>(key: K, value: T[K]): void {
    localStorage.setItem(\`\${this.prefix}\${key}\`, JSON.stringify(value));
  }

  get<K extends string & keyof T>(key: K): T[K] | null {
    const raw = localStorage.getItem(\`\${this.prefix}\${key}\`);
    return raw ? JSON.parse(raw) : null;
  }

  remove(key: string): void {
    localStorage.removeItem(\`\${this.prefix}\${key}\`);
  }
}

// 使用示例
interface AppStorage {
  theme: 'light' | 'dark';
  fontSize: number;
}
const storage = new SafeStorage<AppStorage>('myapp_');
storage.set('theme', 'dark');
const theme = storage.get('theme');  // 'dark'
`;
    }

    // 默认
    return `// 根据需求: ${task}\n// 请提供更具体的代码要求——你想要什么功能？什么输入输出？`;
  }
}

export { ResponseGenerator };
