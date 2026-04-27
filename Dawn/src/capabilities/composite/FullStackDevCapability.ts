/**
 * FullStackDevCapability — 全栈项目生成能力
 * 根据用户描述自动生成完整的前后端项目骨架。
 */
import type { TaskCategory } from '@dawn/core';
import type { CompositeCapability } from '../registry/types.js';

export interface ProjectConfig {
  name: string;
  framework: 'react' | 'vue' | 'none';
  database: 'sqlite' | 'none';
}

export interface GeneratedFile {
  path: string;
  content: string;
}

export class FullStackDevCapability implements CompositeCapability {
  readonly name = 'fullstack_dev';
  readonly description = '全栈项目生成：根据描述自动生成完整的前后端项目';
  readonly subCapabilities: string[] = [];

  async execute(input: import('../registry/types.js').AtomicInput, _registry?: { getAtomic(name: string): import('../registry/types.js').AtomicCapability | undefined }): Promise<import('../registry/types.js').CapabilityResult> {
    const rawInput = typeof input.params?.rawInput === 'string' ? input.params.rawInput : '';
    const config = this.parseConfig(rawInput);

    const generatedFiles = [
      ...this.generateDatabaseFiles(config),
      {
        path: 'package.json',
        content: this.generatePackageJson(config),
      },
      {
        path: 'tsconfig.json',
        content: this.generateTsConfig(),
      },
      {
        path: 'src/index.ts',
        content: this.generateEntryPoint(config),
      },
      {
        path: '.env.example',
        content: this.generateEnvExample(config),
      },
      {
        path: 'README.md',
        content: this.generateReadme(config),
      },
    ];

    return {
      success: true,
      output: JSON.stringify({
        type: 'fullstack_project',
        config,
        files: generatedFiles,
        summary: `已生成 ${config.name} 项目骨架，共 ${generatedFiles.length} 个文件`,
      }, null, 2),
    };
  }

  private parseConfig(input: string): ProjectConfig {
    const name = input.match(/项目[：:]\s*(\S+)/)?.[1] ?? 'my-app';
    const framework = input.includes('vue') ? 'vue' : input.includes('react') ? 'react' : 'none';
    const database = input.includes('sqlite') || input.includes('数据库') ? 'sqlite' : 'none';
    return { name, framework, database };
  }

  private generateDatabaseFiles(config: ProjectConfig): GeneratedFile[] {
    const files: GeneratedFile[] = [];

    if (config.database === 'sqlite') {
      files.push({
        path: 'src/database/index.ts',
        content: `import { Database } from 'bun:sqlite';
const db = new Database('data.db');

db.run(\`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
\`);

export default db;`
      });

      files.push({
        path: 'src/models/User.ts',
        content: `export interface User {
  id: number;
  name: string;
  email: string;
  createdAt: Date;
}

export class UserModel {
  static async create(data: Partial<User>): Promise<User> {
    return data as User;
  }

  static async findById(id: number): Promise<User | null> {
    return null;
  }

  static async findAll(): Promise<User[]> {
    return [];
  }
}`
      });
    }

    return files;
  }

  private generatePackageJson(config: ProjectConfig): string {
    const dependencies: Record<string, string> = {};
    if (config.framework === 'react') {
      dependencies['react'] = '^18.2.0';
      dependencies['react-dom'] = '^18.2.0';
    }
    return JSON.stringify({
      name: config.name,
      module: 'index.ts',
      type: 'module',
      scripts: {
        dev: 'bun run src/server.ts',
        build: 'tsc',
        start: 'bun run src/server.ts'
      },
      dependencies,
      devDependencies: {
        typescript: '^5.3.0',
        '@types/node': '^20.10.0'
      }
    }, null, 2);
  }

  private generateTsConfig(): string {
    return JSON.stringify({
      compilerOptions: {
        target: 'ESNext',
        module: 'ESNext',
        moduleResolution: 'bundler',
        strict: true,
        skipLibCheck: true,
        outDir: './dist',
        rootDir: './src'
      },
      include: ['src/**/*']
    }, null, 2);
  }

  private generateEntryPoint(config: ProjectConfig): string {
    return `console.log('Dawn 全栈项目 ${config.name} 已启动');`;
  }

  private generateEnvExample(config: ProjectConfig): string {
    return `PORT=3000
DATABASE_URL="sqlite:data.db"`;
  }

  private generateReadme(config: ProjectConfig): string {
    return `# ${config.name}
由 Dawn 全栈开发引擎自动生成
`;
  }

  private createComponent(type: string, name: string, props?: any): string {
    return `export function ${name}() {
  return <div>${name} 组件</div>;
}`;
  }

  private createAPIHandler(route: string, method: string, handler: string): string {
    return `export async function ${handler}(req: Request) {
  return Response.json({
    success: true,
    data: "来自 Dawn 的 API",
    timestamp: Date.now()
  });
}`;
  }
}
