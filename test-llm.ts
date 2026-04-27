/**
 * 验证 DeepSeek LLM 调用路径
 * 用法: DEEPSEEK_API_KEY=sk-xxx bun run test-llm.ts
 */
const apiKey = process.env.DEEPSEEK_API_KEY;
if (!apiKey || apiKey === 'sk-your-api-key-here') {
  console.log('❌ DEEPSEEK_API_KEY 未设置。请先在 .env 填写真实 key');
  console.log('   获取地址: https://platform.deepseek.com/api_keys');
  process.exit(1);
}

const baseURL = (process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/+$/, '');
const url = `${baseURL}/v1/chat/completions`;

console.log(`[TEST] 调用 DeepSeek: POST ${url}`);
console.log(`[TEST] API Key: ${apiKey.slice(0, 8)}...${apiKey.slice(-4)}`);

const res = await fetch(url, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${apiKey}`,
  },
  body: JSON.stringify({
    model: 'deepseek-chat',
    messages: [
      { role: 'system', content: '你是一个专业的 TypeScript 编程助手。直接回答，不要反问。' },
      { role: 'user', content: '写一个带 leading 和 trailing edge 的 TypeScript 防抖函数' },
    ],
    temperature: 0.3,
    max_tokens: 1024,
    stream: false,
  }),
});

if (!res.ok) {
  const errText = await res.text();
  console.log(`❌ HTTP ${res.status}: ${errText}`);
  process.exit(1);
}

const json = await res.json();
const content = json?.choices?.[0]?.message?.content;
if (content) {
  console.log('✅ DeepSeek 调用成功!');
  console.log('--- 生成代码 ---');
  console.log(content);
} else {
  console.log('❌ 响应格式异常:', JSON.stringify(json).slice(0, 200));
}
