import { readFileSync, existsSync } from 'fs';

function parentDir(p: string): string {
  const normalized = p.replace(/\\/g, '/');
  const lastSlash = normalized.lastIndexOf('/');
  if (lastSlash === -1) return normalized;
  return normalized.slice(0, lastSlash) || normalized;
}

const panelDir = import.meta.dir.replace(/\\/g, '/');
console.log('panelDir:', panelDir);

const dawnNewRoot = parentDir(panelDir);
console.log('dawnNewRoot:', dawnNewRoot);

const envPath = dawnNewRoot + '/.env';
console.log('envPath:', envPath);
console.log('envPath exists:', existsSync(envPath));

if (existsSync(envPath)) {
  const content = readFileSync(envPath, 'utf-8');
  console.log('--- .env content (first 200 chars) ---');
  console.log(content.substring(0, 200));
  console.log('--- end ---');

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^['"]|['"]$/g, '');
    if (!process.env[key]) {
      process.env[key] = val;
    }
  }

  console.log('DEEPSEEK_API_KEY after loadEnv:', process.env.DEEPSEEK_API_KEY ? 'SET (prefix: ' + process.env.DEEPSEEK_API_KEY.substring(0, 10) + '...)' : 'NOT SET');
} else {
  console.log('.env NOT FOUND');
}
