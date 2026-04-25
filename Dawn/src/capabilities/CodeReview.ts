import * as ts from 'typescript'
import * as fs from 'fs'
import * as path from 'path'

export interface CodeIssue {
  type: 'security' | 'performance' | 'best-practice' | 'bug'
  severity: 'high' | 'medium' | 'low'
  message: string
  file: string
  line: number
  column: number
  suggestion: string
}

export interface SecurityPattern {
  pattern: string
  type: 'security'
  severity: 'high' | 'medium' | 'low'
  message: string
  suggestion: string
}

export interface PerformancePattern {
  pattern: string
  type: 'performance'
  severity: 'high' | 'medium' | 'low'
  message: string
  suggestion: string
}

export interface BestPracticePattern {
  pattern: string
  type: 'best-practice'
  severity: 'high' | 'medium' | 'low'
  message: string
  suggestion: string
}

export class CodeReviewEngine {
  private securityPatterns: SecurityPattern[] = [
    {
      pattern: 'eval\\(',
      type: 'security',
      severity: 'high',
      message: '使用 eval() 可能导致代码注入攻击',
      suggestion:
        '使用 JSON.parse() 或 Function() 替代，或完全避免动态代码执行',
    },
    {
      pattern: 'innerHTML\\s*=',
      type: 'security',
      severity: 'high',
      message: '直接设置 innerHTML 可能导致 XSS 攻击',
      suggestion: '使用 textContent 或 DOMPurify.sanitize() 清理 HTML',
    },
    {
      pattern: 'localStorage\\.setItem\\([^)]*password[^)]*\\)',
      type: 'security',
      severity: 'high',
      message: '在 localStorage 中存储密码不安全',
      suggestion: '使用加密存储或服务器端存储敏感信息',
    },
    {
      pattern: 'console\\.log\\([^)]*password[^)]*\\)',
      type: 'security',
      severity: 'medium',
      message: '在控制台输出敏感信息',
      suggestion: '移除调试日志或使用环境变量控制日志输出',
    },
    {
      pattern: 'process\\.env\\.([A-Z_]+)\\s*=\\s*',
      type: 'security',
      severity: 'medium',
      message: '运行时修改环境变量可能导致安全问题',
      suggestion: '避免在运行时修改环境变量，使用配置对象替代',
    },
  ]

  private performancePatterns: PerformancePattern[] = [
    {
      pattern: 'for\\s*\\([^;]*;[^;]*;[^)]*\\)\\s*{[^}]*\\s*\\+=\\s*',
      type: 'performance',
      severity: 'medium',
      message: '在循环中使用字符串拼接性能较差',
      suggestion: '使用数组的 join() 方法或模板字符串',
    },
    {
      pattern: 'document\\.querySelectorAll\\([^)]*\\)\\s*\\.forEach',
      type: 'performance',
      severity: 'low',
      message: '频繁的 DOM 查询影响性能',
      suggestion: '缓存查询结果或使用事件委托',
    },
    {
      pattern: 'setTimeout\\([^,]*,\\s*0\\)',
      type: 'performance',
      severity: 'low',
      message: '使用 setTimeout(fn, 0) 可能导致不必要的重绘',
      suggestion: '使用 requestAnimationFrame() 或 microtask',
    },
    {
      pattern: 'JSON\\.parse\\(JSON\\.stringify\\([^)]*\\)\\)',
      type: 'performance',
      severity: 'medium',
      message: '使用 JSON 序列化/反序列化进行深拷贝性能较差',
      suggestion: '使用结构化克隆或专门的深拷贝库',
    },
    {
      pattern: 'Array\\([0-9]+\\)\\.fill\\([^)]*\\)\\.map',
      type: 'performance',
      severity: 'low',
      message: '创建大数组并立即映射可能浪费内存',
      suggestion: '使用循环或生成器函数',
    },
  ]

  private bestPracticePatterns: BestPracticePattern[] = [
    {
      pattern: '==\\s*null',
      type: 'best-practice',
      severity: 'low',
      message: '使用 == 与 null 比较可能产生意外结果',
      suggestion: '使用 === null 或 ?? 运算符',
    },
    {
      pattern: 'var\\s+',
      type: 'best-practice',
      severity: 'low',
      message: '使用 var 可能导致变量提升和作用域问题',
      suggestion: '使用 const 或 let 替代 var',
    },
    {
      pattern:
        'function\\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\\s*\\([^)]*\\)\\s*{[^}]*arguments[^}]*}',
      type: 'best-practice',
      severity: 'low',
      message: '使用 arguments 对象不利于类型检查和优化',
      suggestion: '使用剩余参数 (...args) 替代 arguments',
    },
    {
      pattern: '\\/\\/\\s*TODO:',
      type: 'best-practice',
      severity: 'low',
      message: 'TODO 注释可能被遗忘',
      suggestion: '创建 issue 或使用任务管理系统跟踪 TODO',
    },
    {
      pattern: 'catch\\s*\\([^)]*\\)\\s*{\\s*\\}',
      type: 'best-practice',
      severity: 'medium',
      message: '空的 catch 块可能隐藏错误',
      suggestion: '至少记录错误或重新抛出',
    },
  ]

  async reviewFile(filePath: string): Promise<CodeIssue[]> {
    const issues: CodeIssue[] = []

    try {
      const sourceCode = fs.readFileSync(filePath, 'utf-8')

      // 检查安全模式
      for (const pattern of this.securityPatterns) {
        const regex = new RegExp(pattern.pattern, 'g')
        let match
        while ((match = regex.exec(sourceCode)) !== null) {
          const lines = sourceCode.substring(0, match.index).split('\n')
          const line = lines.length
          const column = match.index - lines.slice(0, -1).join('\n').length - 1

          issues.push({
            type: pattern.type,
            severity: pattern.severity,
            message: pattern.message,
            file: filePath,
            line,
            column,
            suggestion: pattern.suggestion,
          })
        }
      }

      // 检查性能模式
      for (const pattern of this.performancePatterns) {
        const regex = new RegExp(pattern.pattern, 'g')
        let match
        while ((match = regex.exec(sourceCode)) !== null) {
          const lines = sourceCode.substring(0, match.index).split('\n')
          const line = lines.length
          const column = match.index - lines.slice(0, -1).join('\n').length - 1

          issues.push({
            type: pattern.type,
            severity: pattern.severity,
            message: pattern.message,
            file: filePath,
            line,
            column,
            suggestion: pattern.suggestion,
          })
        }
      }

      // 检查最佳实践模式
      for (const pattern of this.bestPracticePatterns) {
        const regex = new RegExp(pattern.pattern, 'g')
        let match
        while ((match = regex.exec(sourceCode)) !== null) {
          const lines = sourceCode.substring(0, match.index).split('\n')
          const line = lines.length
          const column = match.index - lines.slice(0, -1).join('\n').length - 1

          issues.push({
            type: pattern.type,
            severity: pattern.severity,
            message: pattern.message,
            file: filePath,
            line,
            column,
            suggestion: pattern.suggestion,
          })
        }
      }

      // 使用 TypeScript AST 进行更深入的分析
      const sourceFile = ts.createSourceFile(
        filePath,
        sourceCode,
        ts.ScriptTarget.Latest,
        true,
      )

      this.analyzeAST(sourceFile, filePath, issues)
    } catch (error) {
      console.error(`分析文件 ${filePath} 时出错:`, error)
    }

    return issues
  }

  private analyzeAST(
    node: ts.Node,
    filePath: string,
    issues: CodeIssue[],
  ): void {
    // 检查未处理的 Promise
    if (ts.isCallExpression(node)) {
      const expression = node.expression
      if (ts.isIdentifier(expression)) {
        const functionName = expression.text
        if (
          functionName === 'fetch' ||
          functionName === 'axios' ||
          functionName === 'request'
        ) {
          // 检查是否有 await 或 .then/.catch
          let hasAwait = false
          let hasThenCatch = false

          ts.forEachChild(node, child => {
            if (ts.isAwaitExpression(child)) {
              hasAwait = true
            }
            if (ts.isPropertyAccessExpression(child)) {
              const name = child.name.text
              if (name === 'then' || name === 'catch' || name === 'finally') {
                hasThenCatch = true
              }
            }
          })

          if (!hasAwait && !hasThenCatch) {
            const { line, character } = this.getLineAndCharacter(node, filePath)
            issues.push({
              type: 'bug',
              severity: 'medium',
              message: '异步函数调用未处理 Promise',
              file: filePath,
              line: line + 1,
              column: character + 1,
              suggestion: '添加 await 或 .then/.catch 处理异步结果',
            })
          }
        }
      }
    }

    // 检查深度嵌套
    if (ts.isBlock(node)) {
      const depth = this.getNestingDepth(node)
      if (depth > 4) {
        const { line, character } = this.getLineAndCharacter(node, filePath)
        issues.push({
          type: 'best-practice',
          severity: 'medium',
          message: `代码嵌套深度 ${depth} 层，可读性差`,
          file: filePath,
          line: line + 1,
          column: character + 1,
          suggestion: '提取函数或使用提前返回减少嵌套',
        })
      }
    }

    // 检查过长的函数
    if (
      ts.isFunctionDeclaration(node) ||
      ts.isFunctionExpression(node) ||
      ts.isArrowFunction(node)
    ) {
      const length = this.getFunctionLength(node)
      if (length > 50) {
        const { line, character } = this.getLineAndCharacter(node, filePath)
        issues.push({
          type: 'best-practice',
          severity: 'medium',
          message: `函数过长 (${length} 行)，职责不单一`,
          file: filePath,
          line: line + 1,
          column: character + 1,
          suggestion: '拆分成多个小函数，每个函数只做一件事',
        })
      }
    }

    // 递归检查子节点
    ts.forEachChild(node, child => this.analyzeAST(child, filePath, issues))
  }

  private getNestingDepth(node: ts.Node): number {
    let depth = 0
    let current = node.parent

    while (current) {
      if (
        ts.isBlock(current) ||
        ts.isIfStatement(current) ||
        ts.isForStatement(current) ||
        ts.isWhileStatement(current) ||
        ts.isSwitchStatement(current) ||
        ts.isTryStatement(current)
      ) {
        depth++
      }
      current = current.parent
    }

    return depth
  }

  private getFunctionLength(node: ts.FunctionLikeDeclaration): number {
    const sourceFile = node.getSourceFile()
    const fullText = sourceFile.getFullText()
    const start = node.getStart()
    const end = node.getEnd()
    const functionText = fullText.substring(start, end)

    return functionText.split('\n').length
  }

  private getLineAndCharacter(
    node: ts.Node,
    filePath: string,
  ): { line: number; character: number } {
    const sourceFile = node.getSourceFile()
    const position = node.getStart()
    return sourceFile.getLineAndCharacterOfPosition(position)
  }

  async reviewProject(
    projectPath: string,
    filePatterns: string[] = ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
  ): Promise<CodeIssue[]> {
    const allIssues: CodeIssue[] = []

    for (const pattern of filePatterns) {
      const files = this.findFiles(projectPath, pattern)

      for (const file of files) {
        const issues = await this.reviewFile(file)
        allIssues.push(...issues)
      }
    }

    // 按严重程度排序
    const severityOrder = { high: 0, medium: 1, low: 2 }
    return allIssues.sort((a, b) => {
      if (severityOrder[a.severity] !== severityOrder[b.severity]) {
        return severityOrder[a.severity] - severityOrder[b.severity]
      }
      return a.type.localeCompare(b.type)
    })
  }

  private findFiles(dir: string, pattern: string): string[] {
    const files: string[] = []

    try {
      const items = fs.readdirSync(dir)

      for (const item of items) {
        const fullPath = path.join(dir, item)
        const stat = fs.statSync(fullPath)

        if (stat.isDirectory()) {
          if (item !== 'node_modules' && item !== '.git') {
            files.push(...this.findFiles(fullPath, pattern))
          }
        } else if (this.matchesPattern(item, pattern)) {
          files.push(fullPath)
        }
      }
    } catch (error) {
      console.error(`读取目录 ${dir} 时出错:`, error)
    }

    return files
  }

  private matchesPattern(filename: string, pattern: string): boolean {
    if (pattern === '**/*.ts') return filename.endsWith('.ts')
    if (pattern === '**/*.tsx') return filename.endsWith('.tsx')
    if (pattern === '**/*.js') return filename.endsWith('.js')
    if (pattern === '**/*.jsx') return filename.endsWith('.jsx')
    return false
  }

  generateReport(issues: CodeIssue[]): string {
    let report = '# 代码审查报告\n\n'

    const byType = {
      security: issues.filter(i => i.type === 'security'),
      performance: issues.filter(i => i.type === 'performance'),
      'best-practice': issues.filter(i => i.type === 'best-practice'),
      bug: issues.filter(i => i.type === 'bug'),
    }

    for (const [type, typeIssues] of Object.entries(byType)) {
      if (typeIssues.length > 0) {
        report += `## ${this.getTypeName(type)} (${typeIssues.length} 个问题)\n\n`

        const bySeverity = {
          high: typeIssues.filter(i => i.severity === 'high'),
          medium: typeIssues.filter(i => i.severity === 'medium'),
          low: typeIssues.filter(i => i.severity === 'low'),
        }

        for (const [severity, severityIssues] of Object.entries(bySeverity)) {
          if (severityIssues.length > 0) {
            report += `### ${this.getSeverityName(severity)} (${severityIssues.length} 个)\n\n`

            for (const issue of severityIssues) {
              const fileName = path.relative(process.cwd(), issue.file)
              report += `- **${fileName}:${issue.line}:${issue.column}** - ${issue.message}\n`
              report += `  建议: ${issue.suggestion}\n\n`
            }
          }
        }
      }
    }

    if (issues.length === 0) {
      report += '✅ 未发现代码问题！\n'
    }

    return report
  }

  private getTypeName(type: string): string {
    const names: Record<string, string> = {
      security: '安全问题',
      performance: '性能问题',
      'best-practice': '最佳实践',
      bug: '潜在 Bug',
    }
    return names[type] || type
  }

  private getSeverityName(severity: string): string {
    const names: Record<string, string> = {
      high: '高优先级',
      medium: '中优先级',
      low: '低优先级',
    }
    return names[severity] || severity
  }
}
