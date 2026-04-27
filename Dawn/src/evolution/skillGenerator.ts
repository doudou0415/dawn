import { writeFile, readFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { TaskAnalysis } from './SelfEvolutionEngine';

interface Skill {
  id: string;
  name: string;
  description: string;
  category: string;
  tools: string[];
  steps: string[];
  examples: string[];
  createdAt: string;
  updatedAt: string;
  usageCount: number;
}

interface SkillTemplate {
  id: string;
  name: string;
  category: string;
  pattern: RegExp;
  generate: (task: TaskAnalysis) => Omit<Skill, 'id' | 'createdAt' | 'updatedAt' | 'usageCount'>;
}

export class SkillGenerator {
  private skillsFile: string;
  private templates: SkillTemplate[] = [];

  constructor(skillsDir?: string) {
    const baseDir = skillsDir || join(process.cwd(), '.dawn-memory');
    this.skillsFile = join(baseDir, 'skills.json');
    this.initializeTemplates();
  }

  private initializeTemplates(): void {
    this.templates = [
      {
        id: 'code-generation',
        name: '代码生成',
        category: 'programming',
        pattern: /(生成|创建|编写|实现|开发).*代码|code.*generate/i,
        generate: (task: TaskAnalysis) => ({
          name: '代码生成',
          description: '根据需求生成代码',
          category: 'programming',
          tools: ['code_generation', 'code_review'],
          steps: [
            '分析任务需求',
            '生成符合要求的代码',
            '审查代码质量',
            '返回代码结果'
          ],
          examples: [task.description]
        })
      },
      {
        id: 'code-optimization',
        name: '代码优化',
        category: 'programming',
        pattern: /(优化|改进|重构|调整).*代码|code.*optimize/i,
        generate: (task: TaskAnalysis) => ({
          name: '代码优化',
          description: '优化现有代码',
          category: 'programming',
          tools: ['code_optimization', 'code_review'],
          steps: [
            '分析现有代码',
            '根据需求进行优化',
            '审查优化结果',
            '返回优化后的代码'
          ],
          examples: [task.description]
        })
      }
    ];
  }

  async generateSkillFromTask(task: TaskAnalysis): Promise<Skill | null> {
    // 检查任务是否适合生成技能
    if (task.toolsUsed.length < 2 || !task.success) {
      return null;
    }

    // 找到匹配的模板（排除通配模板，优先精确匹配）
    const template = this.templates.find(t => t.pattern.test(task.description) && t.id !== 'general-request');
    if (!template) {
      return null;
    }

    // 生成技能
    const skillData = template.generate(task);
    const skill: Skill = {
      ...skillData,
      id: this.generateSkillId(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      usageCount: 0
    };

    // 保存技能
    await this.saveSkill(skill);
    return skill;
  }

  async saveSkill(skill: Skill): Promise<void> {
    const skills = await this.loadSkills();
    const existingIndex = skills.findIndex(s => s.id === skill.id);

    if (existingIndex >= 0) {
      skills[existingIndex] = skill;
    } else {
      skills.push(skill);
    }

    await this.ensureSkillsFile();
    await writeFile(this.skillsFile, JSON.stringify(skills, null, 2), 'utf8');
  }

  async loadSkills(): Promise<Skill[]> {
    if (!existsSync(this.skillsFile)) {
      return [];
    }

    try {
      const content = await readFile(this.skillsFile, 'utf8');
      const skills = JSON.parse(content);
      return Array.isArray(skills) ? skills : [];
    } catch (error) {
      return [];
    }
  }

  async getSkills(category?: string): Promise<Skill[]> {
    const skills = await this.loadSkills();
    return category ? skills.filter(s => s.category === category) : skills;
  }

  async getSkillById(id: string): Promise<Skill | null> {
    const skills = await this.loadSkills();
    return skills.find(s => s.id === id) || null;
  }

  async incrementUsage(id: string): Promise<void> {
    const skills = await this.loadSkills();
    const skill = skills.find(s => s.id === id);
    if (skill) {
      skill.usageCount++;
      skill.updatedAt = new Date().toISOString();
      await this.saveSkill(skill);
    }
  }

  private async ensureSkillsFile(): Promise<void> {
    const dir = dirname(this.skillsFile);
    try {
      await mkdir(dir, { recursive: true });
    } catch (error) {
      // 目录已存在，忽略错误
    }
  }

  private generateSkillId(): string {
    return `skill-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  // 从任务历史批量生成技能
  async generateSkillsFromHistory(tasks: TaskAnalysis[]): Promise<Skill[]> {
    const generatedSkills: Skill[] = [];

    for (const task of tasks) {
      const skill = await this.generateSkillFromTask(task);
      if (skill) {
        generatedSkills.push(skill);
      }
    }

    return generatedSkills;
  }
}

// 全局技能生成器单例
let globalSkillGenerator: SkillGenerator | null = null;

export function getSkillGenerator(skillsDir?: string): SkillGenerator {
  if (!globalSkillGenerator) {
    globalSkillGenerator = new SkillGenerator(skillsDir);
  }
  return globalSkillGenerator;
}