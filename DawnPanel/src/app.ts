/**
 * Dawn Panel — 桌面客户端入口
 * 通过 IPC 与 Dawn CLI 后端通信
 */

interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

class DawnPanelApp {
  private messages: Message[] = [];
  private msgContainer: HTMLElement;
  private input: HTMLInputElement;
  private sendBtn: HTMLButtonElement;

  constructor() {
    this.msgContainer = document.getElementById('messages')!;
    this.input = document.getElementById('input') as HTMLInputElement;
    this.sendBtn = document.getElementById('send-btn') as HTMLButtonElement;

    this.bindEvents();
    this.addMessage('assistant', '你好！我是 Dawn Panel，你的 AI 编程助手。');
  }

  private bindEvents(): void {
    this.sendBtn.addEventListener('click', () => this.handleSend());
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.handleSend();
    });
  }

  private async handleSend(): Promise<void> {
    const text = this.input.value.trim();
    if (!text) return;

    this.addMessage('user', text);
    this.input.value = '';
    this.input.disabled = true;
    this.sendBtn.disabled = true;
    this.sendBtn.textContent = '处理中...';

    try {
      // TODO: 通过 IPC 调用 Dawn CLI
      const response = await this.callDawnBackend(text);
      this.addMessage('assistant', response);
    } catch (error) {
      this.addMessage('assistant', `错误: ${(error as Error).message}`);
    } finally {
      this.input.disabled = false;
      this.sendBtn.disabled = false;
      this.sendBtn.textContent = '发送';
      this.input.focus();
    }
  }

  private async callDawnBackend(input: string): Promise<string> {
    // 占位：后续通过 Tauri IPC / WebSocket 连接 Dawn CLI
    return `[Dawn 处理中] ${input}`;
  }

  private addMessage(role: 'user' | 'assistant', content: string): void {
    this.messages.push({ role, content, timestamp: Date.now() });
    const div = document.createElement('div');
    div.className = `message message-${role}`;
    div.innerHTML = `
      <strong>${role === 'user' ? '你' : 'Dawn'}</strong>
      <div class="message-content">${this.escapeHtml(content)}</div>
    `;
    this.msgContainer.appendChild(div);
    this.msgContainer.scrollTop = this.msgContainer.scrollHeight;
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}

new DawnPanelApp();
