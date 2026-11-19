/* 构建前把后端地址写进 capacitor.config.json（CI 与本地均可调用） */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const cfgPath = fileURLToPath(new URL('../capacitor.config.json', import.meta.url));
const raw = (process.env.WETALK_SERVER_URL || '').trim();
const url = raw.replace(/\/+$/, '');

const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
cfg.server = cfg.server || {};

if (url) {
  if (!/^https?:\/\//i.test(url)) {
    console.error('WETALK_SERVER_URL 必须以 http:// 或 https:// 开头');
    process.exit(1);
  }
  cfg.server.url = url;
  cfg.server.cleartext = url.startsWith('http://');
  console.log(`已注入 server.url = ${url}`);
} else {
  cfg.server.url = '';
  console.log('未设置 WETALK_SERVER_URL：App 使用内置页面，首次运行时在登录页填写服务器地址。');
}

writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n');
