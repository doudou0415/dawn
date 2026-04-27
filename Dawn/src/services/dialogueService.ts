import { resolve } from 'path';
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { callDeepSeek, SYSTEM_PROMPT } from './llmService.js';

export class DialogueService {
  private conversationContext: {
    sessionId: string;
    messages: Array<{ id: string; role: string; content: string; timestamp: string }>;
    currentTopic: string | null;
    lastTask: string | null;
    entityMemory: Map<string, string>;
    createdAt: string;
    updatedAt: string;
    dialogueState: { type: string; id: string; timestamp: string; data: Record<string, any>; previousStateId?: string; nextStateId?: string };
    dialogueHistory: Array<{ type: string; id: string; timestamp: string; data: Record<string, any> }>;
    currentIntent: string | null;
    expectedInput: string | null;
    followUpQuestions: string[];
  };

  constructor() {
    this.conversationContext = {
      sessionId: '',
      messages: [],
      currentTopic: null,
      lastTask: null,
      entityMemory: new Map(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      dialogueState: { type: 'greeting', id: '', timestamp: '', data: {} },
      dialogueHistory: [],
      currentIntent: null,
      expectedInput: null,
      followUpQuestions: [],
    };
  }

  async generateConversationalResponse(input: string): Promise<string> {
    const lower = input.toLowerCase();

    // === ⚠️ 核心规则：收到任何代码/文件操作请求，必须先验证 ===
    if (this.hasFileOrCodeIntent(lower)) {
      return this.attemptFileOperation(input);
    }

    if (this.containsGreeting(lower)) {
      const rest = input.replace(/你好|您好|hi|hello|嗨|hey|早上好|下午好|晚上好|在吗|在嘛/ig, '').trim();
      return rest || '嗨，我是 Dawn。写代码、改代码、查问题都行，直接说。';
    }

    if (this.isConfirmation(lower)) {
      const lastMessages = this.getLastNMessages(3);
      const hasRecentTask = lastMessages.some(m => m.role === 'user');
      if (hasRecentTask) {
        return '好，你刚才是有什么任务要继续？';
      }
      return '嗯，你说。';
    }

    if (this.isNegation(lower)) {
      return '好，有需要再叫我。';
    }

    // 继续上次任务
    if (this.conversationContext.lastTask &&
        (lower.includes('继续') || lower.includes('还有') || lower.includes('还要') || lower.includes('接着'))) {
      return this.continueLastTask();
    }

    return `"${input}"，这个需求我需要先检查一下，请说得更具体些。`;
  }

  private handleQuestion(question: string): string {
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

    return `关于"${question}"，这是一个编程问题。有具体代码或场景的话可以展开说。`;
  }

  async answerQuestion(question: string): Promise<string> {
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

  private explainConcept(question: string): string {
    const concepts: Record<string, string> = {
      '闭包': `闭包是指一个函数能访问其词法作用域之外的变量。即使外部函数已返回，内部函数仍持有对外部变量的引用。

实际例子：
\`\`\`typescript
function createCounter() {
  let count = 0;  // 外部变量
  return function() {
    count++;      // 内部函数访问外部变量
    return count;
  };
}

const counter = createCounter();
console.log(counter()); // 1
console.log(counter()); // 2
console.log(counter()); // 3
// count 变量没有被销毁，因为闭包还引用着它
\`\`\`

**实用场景**：
- **数据私有化**：封装不想暴露的变量
- **函数工厂**：生成带状态的函数
- **防抖/节流**：保存 timer 引用
- **React Hooks**：每个组件实例都有独立的闭包`,
      'promise': `Promise 是 JavaScript 处理异步操作的对象，表示一个未来完成的操作。

状态：Pending → Fulfilled / Rejected

\`\`\`typescript
// 基础用法
fetch('/api/data')
  .then(res => res.json())
  .then(data => console.log(data))
  .catch(err => console.error(err));

// Promise.all — 并行
const [users, posts] = await Promise.all([
  fetch('/users').then(r => r.json()),
  fetch('/posts').then(r => r.json()),
]);
\`\`\``,
      'async': `async/await 是 Promise 的语法糖，让异步代码看起来像同步代码。

\`\`\`typescript
async function getData() {
  try {
    const res = await fetch('/api/data');
    const data = await res.json();
    return data;
  } catch (err) {
    console.error('请求失败:', err);
    throw err;
  }
}
\`\`\`

注意：await 只能在 async 函数内使用；async 函数始终返回 Promise。`,
      'typescript': 'TypeScript 是 JavaScript 的超集，在 JS 基础上增加了静态类型系统。编译时就能捕获类型错误，IDE 支持更好（自动补全、重构）。适合中大型项目，但小型脚本用纯 JS 也完全没问题。',
      'react': 'React 是一个构建用户界面的 JavaScript 库。核心是组件化，UI 被拆成独立、可复用的组件。使用虚拟 DOM 做高效渲染，数据流是单向的（父→子通过 props）。',
      'hook': `Hook 是 React 16.8 引入的特性，让函数组件能使用状态和生命周期能力。

常用 Hook：
\`\`\`typescript
function Counter() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    document.title = \`计数: \${count}\`;
  }, [count]);
  return <button onClick={() => setCount(c => c + 1)}>{count}</button>;
}
\`\`\``,
      '组件': '组件是 React 应用的基本构建块，封装 UI 结构和逻辑。可以是函数组件或类组件，接收 props 输入，返回 React 元素。好的组件设计应该单一职责、可复用。',
      '状态': '状态（state）是组件内部管理的数据。状态变化会触发组件重新渲染。在函数组件中用 useState Hook 管理。与 props 不同，状态是组件私有的。',
      '属性': '属性（props）是父组件传给子组件的数据。props 是只读的，子组件不能修改。这是 React 单向数据流的核心机制。',
      '虚拟dom': '虚拟 DOM 是真实 DOM 的轻量级 JS 对象表示。每次状态变更时，React 先在虚拟 DOM 上计算差异（diff），然后批量应用最小化的真实 DOM 更新，从而提升性能。',
      'localstorage': `localStorage 是浏览器提供的键值对存储 API，数据不清除就持久保存。

\`\`\`typescript
// 存
localStorage.setItem('theme', 'dark');
// 取
const theme = localStorage.getItem('theme'); // 'dark' | null
// 删
localStorage.removeItem('theme');
// 清空
localStorage.clear();
\`\`\`

注意：只能存字符串，对象需要 JSON.stringify/parse。同源策略下各站点隔离。`,
    };

    const cleanQuestion = question.replace(/^[\?\s，。、孬嘝]+/g, '').replace(/[\？\?]+$/g, '');

    for (const [key, value] of Object.entries(concepts)) {
      if (cleanQuestion.includes(key)) {
        return value;
      }
    }

    const withoutQuestionWords = cleanQuestion
      .replace(/什么是/g, '')
      .replace(/什么叫/g, '')
      .replace(/是何/g, '')
      .replace(/的意思/g, '')
      .trim();

    if (withoutQuestionWords.length > 0) {
      return `"${withoutQuestionWords}" — 这个涉及面有点宽，具体是哪个语言或场景？你一说我直接给你代码或方案。`;
    }

    return `哪里不清楚？说下场景我直接给你解决。`;
  }

  private explainHowTo(question: string): string {
    return `这个问题我遇到过很多次。你用的什么语言或框架？说清楚了直接给你代码。`;
  }

  private explainWhy(question: string): string {
    return `有具体的报错信息或代码片段吗？贴出来我帮你定位原因。`;
  }

  /** 对"如何/怎么"类问题给出直接回答，无匹配时返回 null */
  private directHowTo(question: string): string | null {
    const lower = question.toLowerCase();
    if (lower.includes('调试') && lower.includes('map of undefined')) {
      return `"Cannot read property 'map' of undefined" 表示你试图对一个 undefined 值调用 .map()。调试步骤：

1. **找到对应变量** — 看 .map() 前面是什么变量，比如 \`data.map()\` ，那 \`data\` 就是问题源头
2. **向上追溯** — 这个变量来自哪里？API 响应？props？状态？
3. **加防御** — 最简单的修复：\`(data || []).map(...)\` 或 \`data?.map(...)\`
4. **检查异步时序** — 如果数据来自 API 请求，组件首次渲染时数据还没到，需要加 loading 状态
5. **查看数据结构** — console.log 打印一下响应，确认返回的是数组而不是 undefined

常见场景：
\`\`\`typescript
// 问题代码
const list = response.data.items.map(...)  // items 是 undefined

// 修复 1：可选链 + 空数组兜底
const list = (response.data?.items || []).map(...)

// 修复 2：提前判断
if (!Array.isArray(response.data?.items)) {
  return <Loading />
}
\`\`\``;
    }
    return null;
  }

  /** 对"为什么"类问题给出直接回答，无匹配时返回 null */
  private directWhy(question: string): string | null {
    const lower = question.toLowerCase();
    if (lower.includes('闭包')) {
      return null; // 交给 explainConcept
    }
    return null;
  }

  private isQuestion(text: string): boolean {
    return text.includes('？') || text.includes('?') ||
           text.includes('怎么') || text.includes('如何') ||
           text.includes('什么') || text.includes('为什么') ||
           text.includes('是不是') || text.includes('能不能');
  }

  private containsGreeting(text: string): boolean {
    const greetings = ['你好', 'hi', 'hello', '嗨', 'hey', '早上好', '下午好', '晚上好', '在吗', '在嘛'];
    return greetings.some(g => text.includes(g));
  }

  private isConfirmation(text: string): boolean {
    const confirmations = ['好的', '嗯', 'ok', 'okay', '对对', '没错', '是的'];
    return confirmations.some(c => text === c || text.endsWith(c) || text.startsWith(c));
  }

  private isNegation(text: string): boolean {
    const negations = ['不', '没', '否', '不要', '不用', '算了'];
    return negations.some(n => text.includes(n));
  }

  private isQuestionRequest(task: string): boolean {
    const keywords = ['如何', '怎么', '什么是', '为什么', '何时', '哪里', '谁', '解释', '说明', '告诉我', '？', '?'];
    const questionPatterns = [
      /\?$/,
      /吗$/,
      /呀$/,
      /^为什么/,
      /^如何/,
      /^怎么/,
      /^什么是/
    ];
    return keywords.some(k => task.includes(k)) || questionPatterns.some(p => p.test(task));
  }

  // 处理复杂对话逻辑
  private handleComplexDialogue(text: string, context: {
    conversationContext: {
      dialogueState: { type: string; id: string; timestamp: string; data: Record<string, any>; previousStateId?: string; nextStateId?: string };
      dialogueHistory: Array<{ type: string; id: string; timestamp: string; data: Record<string, any> }>;
      entityMemory: Map<string, string>;
      currentIntent: string | null;
      expectedInput: string | null;
      followUpQuestions: string[];
      lastTask: string | null;
      currentTopic: string | null;
      messages: Array<{ id: string; role: string; content: string; timestamp: string }>;
      sessionId: string;
      createdAt: string;
      updatedAt: string;
    };
    emotionDetector: {
      detect: (text: string) => { emotion: string; intensity: number; confidence: number };
    };
    transitionDialogueState: (newStateType: string, data?: Record<string, any>) => void;
    analyzeIntent: (text: string) => { category: string; confidence: number; parameters: Record<string, any> } | null;
  }): string | null {
    const intentResult = context.analyzeIntent(text);
    const emotion = context.emotionDetector.detect(text);

    // 根据当前对话状态和意图进行处理
    switch (context.conversationContext.dialogueState.type) {
      case 'greeting':
        if (intentResult?.category === 'greeting') {
          context.transitionDialogueState('task_request', {
            intent: 'greeting',
            expectedInput: '用户任务请求'
          });
          return '你好！有什么编程问题我可以帮你解答，或者需要我帮你生成什么代码吗？';
        } else if (intentResult?.category === 'remember') {
          // 提取记忆内容
          const memoryContent = text.replace(/记住|保存|记录|记住我|请记住/g, '').trim();
          if (memoryContent) {
            // 存储到实体记忆
            context.conversationContext.entityMemory.set('user_memory', memoryContent);
            context.transitionDialogueState('follow_up', {
              intent: 'remember',
              followUpQuestions: [
                '我已经记住了，还有其他需要我记住的吗？',
                '还有什么其他信息需要我保存吗？',
                '需要我帮你做什么其他事情吗？'
              ]
            });
            return '好的，我已经记住了！';
          }
        } else if (text.includes('喜欢什么') || text.includes('我喜欢') || text.includes('我的偏好')) {
          // 检索记忆
          const memory = context.conversationContext.entityMemory.get('user_memory');
          if (memory) {
            context.transitionDialogueState('follow_up', {
              intent: 'ask_question',
              followUpQuestions: [
                '还有其他问题吗？',
                '需要我帮你做什么其他事情吗？',
                '还有什么其他信息需要我记住吗？'
              ]
            });
            return `根据我记住的信息，${memory}`;
          } else {
            context.transitionDialogueState('clarification', {
              intent: 'ask_question',
              expectedInput: '用户偏好信息'
            });
            return '我还没有关于你偏好的记忆。你可以告诉我你喜欢什么，我会记住的。';
          }
        }

      case 'task_request':
        if (intentResult?.category === 'code_generation') {
          // 让执行流继续到 generateCodeFromTask，不在此处拦截
          return null;
        } else if (intentResult?.category === 'remember') {
          // 提取记忆内容
          const memoryContent = text.replace(/记住|保存|记录|记住我|请记住/g, '').trim();
          if (memoryContent) {
            // 存储到实体记忆
            context.conversationContext.entityMemory.set('user_memory', memoryContent);
            context.transitionDialogueState('follow_up', {
              intent: 'remember',
              followUpQuestions: [
                '我已经记住了，还有其他需要我记住的吗？',
                '还有什么其他信息需要我保存吗？',
                '需要我帮你做什么其他事情吗？'
              ]
            });
            return '好的，我已经记住了！';
          }
        } else if (text.includes('喜欢什么') || text.includes('我喜欢') || text.includes('我的偏好')) {
          // 检索记忆
          const memory = context.conversationContext.entityMemory.get('user_memory');
          if (memory) {
            context.transitionDialogueState('follow_up', {
              intent: 'ask_question',
              followUpQuestions: [
                '还有其他问题吗？',
                '需要我帮你做什么其他事情吗？',
                '还有什么其他信息需要我记住吗？'
              ]
            });
            return `根据我记住的信息，${memory}`;
          } else {
            context.transitionDialogueState('clarification', {
              intent: 'ask_question',
              expectedInput: '用户偏好信息'
            });
            return '我还没有关于你偏好的记忆。你可以告诉我你喜欢什么，我会记住的。';
          }
        }
        break;

      case 'task_execution':
        if (emotion.emotion === 'positive') {
          context.transitionDialogueState('follow_up', {
            intent: 'feedback',
            followUpQuestions: [
              '你还需要对这段代码进行优化吗？',
              '需要我解释代码的工作原理吗？',
              '还有其他功能需要实现吗？'
            ]
          });
          return '很高兴你对代码满意！你还需要其他帮助吗？';
        } else if (emotion.emotion === 'frustrated') {
          context.transitionDialogueState('clarification', {
            intent: 'feedback',
            expectedInput: '用户具体问题描述'
          });
          return '我注意到你可能对代码有一些问题。能具体告诉我你遇到了什么问题吗？';
        }
        break;

      case 'follow_up':
        // 如果是新的工具任务（包含代码生成/查询关键词），不要用 follow_up 响应拦截
        if (text.includes('写') || text.includes('生成') || text.includes('创建') ||
            text.includes('查') || text.includes('实现') || text.includes('做')) {
          return null;
        }
        if (text.includes('是') || text.includes('需要') || text.includes('对')) {
          context.transitionDialogueState('task_request', {
            intent: 'follow_up',
            expectedInput: '用户具体需求'
          });
          return '好的，告诉我你具体需要什么帮助？';
        } else if (text.includes('不') || text.includes('不需要') || text.includes('够了')) {
          context.transitionDialogueState('conclusion', {
            intent: 'follow_up',
            expectedInput: '用户新的需求'
          });
          return '好的，如果你有其他需要，随时告诉我！';
        } else if (text.includes('喜欢什么') || text.includes('我喜欢') || text.includes('我的偏好') || text.includes('我喜欢什么')) {
          // 检索记忆
          const memory = context.conversationContext.entityMemory.get('user_memory');
          if (memory) {
            context.transitionDialogueState('follow_up', {
              intent: 'ask_question',
              followUpQuestions: [
                '还有其他问题吗？',
                '需要我帮你做什么其他事情吗？',
                '还有什么其他信息需要我记住吗？'
              ]
            });
            return `根据我记住的信息，${memory}`;
          } else {
            context.transitionDialogueState('clarification', {
              intent: 'ask_question',
              expectedInput: '用户偏好信息'
            });
            return '我还没有关于你偏好的记忆。你可以告诉我你喜欢什么，我会记住的。';
          }
        }
    }

    return null;
  }

  // 提取技术相关实体
  private extractTechEntities(text: string): Map<string, string> {
    const entities = new Map<string, string>();
    const techKeywords = [
      'javascript', 'typescript', 'python', 'java', 'c++', 'c#', 'go', 'rust',
      'react', 'vue', 'angular', 'node.js', 'express', 'django', 'flask',
      'html', 'css', 'sass', 'less', 'tailwind', 'bootstrap',
      'mysql', 'postgresql', 'mongodb', 'redis', 'sqlite',
      'git', 'github', 'gitlab', 'bitbucket',
      'vscode', 'intellij', 'eclipse', 'sublime', 'atom'
    ];

    const lowerText = text.toLowerCase();
    techKeywords.forEach(keyword => {
      if (lowerText.includes(keyword.toLowerCase())) {
        entities.set(`tech_${keyword.toLowerCase()}`, keyword);
      }
    });

    return entities;
  }

  // 提取任务相关实体
  private extractTaskEntities(text: string): Map<string, string> {
    const entities = new Map<string, string>();

    // 提取任务类型
    const taskTypes = [
      { pattern: /生成|创建|编写|开发/g, type: 'task_type', value: 'generation' },
      { pattern: /优化|改进|重构|提升/g, type: 'task_type', value: 'optimization' },
      { pattern: /修复|解决|处理|排除/g, type: 'task_type', value: 'fix' },
      { pattern: /解释|说明|介绍|讲解/g, type: 'task_type', value: 'explanation' },
      { pattern: /测试|验证|检查|调试/g, type: 'task_type', value: 'testing' }
    ];

    taskTypes.forEach(({ pattern, type, value }) => {
      if (pattern.test(text)) {
        entities.set(type, value);
      }
    });

    return entities;
  }

  private continueLastTask(): string {
    if (!this.conversationContext.lastTask) {
      return '我没有找到上一次的任务记录。能否重新描述一下你想要完成的任务？';
    }

    const lastMessages = this.getLastNMessages(4);
    const contextSummary = lastMessages.map(m => `${m.role}: ${m.content}`).join('\n');

    return `好的，让我们继续上次的任务。\n\n上一次任务：${this.conversationContext.lastTask}\n\n相关上下文：\n${contextSummary}\n\n请告诉我你想要继续做什么，或者需要什么帮助？`;
  }

  // ⚠️ 以下私有辅助方法是从 Agent 类直接移植，保持原样

  private hasFileOrCodeIntent(input: string): boolean {
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

  private attemptFileOperation(input: string): string {
    const t = input.toLowerCase();

    // 1. 读取文件
    const readMatch = input.match(/(?:读取|读|打开|查看|cat)\s*["']?([\w/\\\.\-]+)["']?/i);
    if (readMatch) {
      const filePath = readMatch[1]!.trim();
      try {
        const absPath = resolve(filePath);
        if (!existsSync(absPath)) {
          return `❌ 文件不存在: ${filePath}，请确认路径是否正确。`;
        }
        const content = readFileSync(absPath, 'utf-8');
        return `## \`${filePath}\` 内容 (${content.length} 字符)\n\n\`\`\`\n${content}\n\`\`\``;
      } catch (err) {
        return `❌ 读取失败: ${(err as Error).message}`;
      }
    }

    // 2. 列出目录
    const listMatch = input.match(/(?:列出|列表|ls|查看目录|dir)\s*["']?([\w/\\\.\-]*)["']?/i);
    if (listMatch) {
      const dirPath = listMatch[1]!.trim() || '.';
      try {
        const absPath = resolve(dirPath);
        if (!existsSync(absPath)) {
          return `❌ 目录不存在: ${dirPath}`;
        }
        const entries = readdirSync(absPath);
        let output = `## \`${dirPath}\` 目录内容 (${entries.length} 项)\n\n`;
        for (const entry of entries) {
          const fullPath = resolve(absPath, entry);
          let prefix = '📄';
          try {
            if (statSync(fullPath).isDirectory()) prefix = '📁';
          } catch {}
          output += `${prefix} ${entry}\n`;
        }
        return output;
      } catch (err) {
        return `❌ 列出目录失败: ${(err as Error).message}`;
      }
    }

    // 3. 检查文件是否存在
    const existMatch = input.match(/(?:检查|是否存在|有没有|找找|查找)\s*["']?([\w/\\\.\-]+)["']?/i);
    if (existMatch) {
      const filePath = existMatch[1]!.trim();
      try {
        const absPath = resolve(filePath);
        const exists = existsSync(absPath);
        if (exists) {
          const stat = statSync(absPath);
          return `✅ 文件存在: ${filePath} (${stat.size} 字节，修改于 ${stat.mtime.toLocaleString()})`;
        } else {
          return `❌ 文件不存在: ${filePath}`;
        }
      } catch (err) {
        return `❌ 检查失败: ${(err as Error).message}`;
      }
    }

    // 4. 搜索文件内容
    const grepMatch = input.match(/(?:搜索|查找|grep|包含|找)\s*["']?([^"']+)["']?/i);
    if (grepMatch) {
      return `搜索功能需要先指定搜索目录，请用：搜索 "关键词" 目录路径`;
    }

    // 5. 审查代码
    if (t.includes('审查') || t.includes('review') || t.includes('检查代码')) {
      return `审查代码需要提供具体文件路径或代码内容。请用：审查 src/xxx.ts`;
    }

    // 没有匹配到具体操作，提示用户
    return `我理解你有文件操作需求，但需要更具体的信息。请说明：\n- 读/写/编辑哪个文件？\n- 或检查/审查哪个目录？`;
  }

  private getLastNMessages(n: number): Array<{ id: string; role: string; content: string; timestamp: string }> {
    return this.conversationContext.messages.slice(-n);
  }
}
