// 意图引擎 - 判断用户输入是否为工具任务
export function looksLikeToolTask(input: string): boolean {
  const keywords = [
    '实现',
    '添加',
    '优化',
    '重构',
    '调试',
    '测试',
    '运行',
    '部署',
    '搜索',
    '查找',
    '获取',
    '抓取',
    '爬取',
    '分析',
    '统计',
    '学习',
    '总结',
    '提取',
    '生成',
    '创建',
    '修改',
    '删除',
    '写',
    '帮我',
    '给我',
    '做一个',
    '编写',
    '开发',
    '做的',
    '制作',
  ]

  return keywords.some(keyword => input.includes(keyword))
}

const MAX_INPUT_LENGTH = 10000

export function validateInput(input: string): {
  valid: boolean
  error?: string
} {
  if (!input || input.trim().length === 0) {
    return { valid: false, error: '输入不能为空' }
  }
  if (input.length > MAX_INPUT_LENGTH) {
    return { valid: false, error: `输入过长，最大 ${MAX_INPUT_LENGTH} 字符` }
  }
  return { valid: true }
}
