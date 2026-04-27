import { describe, it, expect } from 'vitest';

describe('后端 API — HTTP 端点 (DawnPanel)', () => {
  it('后端文件应可读', async () => {
    const fs = await import('fs');
    const content = fs.readFileSync('DawnPanel/src/backend.ts', 'utf-8');
    expect(content.length).toBeGreaterThan(100);
  });

  it('后端应包含 HTTP 服务器启动代码', async () => {
    const fs = await import('fs');
    const content = fs.readFileSync('DawnPanel/src/backend.ts', 'utf-8');
    // DawnPanel 后端使用 Bun.serve
    expect(content).toContain('serve');
  });
});
