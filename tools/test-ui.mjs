/* 用 happy-dom 在 Node 里跑一遍前端：验证演示模式、聊天、朋友圈等主流程。 */
import { Window } from 'happy-dom';
import { readFileSync } from 'node:fs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${extra}`); }
}

const window = new Window({ url: 'http://127.0.0.1:8099/' });
const document = window.document;
document.body.innerHTML = '<div id="app"></div><div id="toast" hidden></div>';
window.localStorage.setItem('wt_demo', '1');

function run(file) {
  const code = readFileSync(new URL(file, import.meta.url), 'utf8');
  const fn = new Function(
    'window', 'document', 'localStorage', 'location', 'history', 'navigator',
    'URLSearchParams', 'FileReader', 'WebSocket', 'setTimeout', 'clearTimeout',
    'prompt', 'history2', code
  );
  fn(window, document, window.localStorage, window.location, window.history, window.navigator,
    window.URLSearchParams, window.FileReader, window.WebSocket, setTimeout, clearTimeout,
    window.prompt, window.history);
}

run('../public/demo.js');
run('../public/app.js');
await sleep(400);

const appText = () => document.getElementById('app').textContent;

function navigate(hash) {
  window.location.hash = hash;
  window.dispatchEvent(new window.Event('hashchange'));
}

console.log('\nWeTalk 前端测试');

check('进入演示模式后渲染会话列表', appText().includes('微信') && appText().includes('妈妈'));
check('会话预览包含最后一条消息', appText().includes('别老是熬夜'));
check('未读角标显示', !!document.querySelector('.badge'));

/* 打开聊天 */
navigate('#/chat/101');
await sleep(300);
check('聊天页加载历史消息', (document.getElementById('messages')?.textContent || '').includes('排骨汤'));
check('输入框与发送按钮存在', !!document.getElementById('composerInput') && !!document.querySelector('[data-act="send"]'));

/* 发送消息 */
const input = document.getElementById('composerInput');
input.value = '我周六早点回来';
document.querySelector('[data-act="send"]').click();
await sleep(400);
check('发送后消息出现在气泡里', (document.getElementById('messages')?.textContent || '').includes('我周六早点回来'));

/* 等自动回复 */
await sleep(3600);
const after = document.getElementById('messages')?.textContent || '';
check('演示模式对方自动回复', after.includes('我周六早点回来') && after.length > 80, JSON.stringify(after.slice(-40)));

/* 返回并检查列表更新 */
navigate('#/chats');
await sleep(250);
check('会话列表预览已随新消息更新', appText().includes('妈妈') && !appText().includes('别老是熬夜'));

/* 通讯录 */
navigate('#/contacts');
await sleep(250);
check('通讯录列出好友', appText().includes('陈一诺') && appText().includes('苏晚'));

/* 发现页与朋友圈 */
navigate('#/discover');
await sleep(250);
check('发现页包含朋友圈/视频号/小程序', appText().includes('朋友圈') && appText().includes('视频号') && appText().includes('小程序'));

navigate('#/moments');
await sleep(250);
check('朋友圈渲染动态与点赞', appText().includes('东山岛') && appText().includes('♥'));

const likeBtn = document.querySelector('[data-act="like-moment"]');
if (likeBtn) likeBtn.click();
await sleep(250);
check('点赞后状态切换', (document.querySelector('[data-act="like-moment"]')?.textContent || '') === '取消');

/* 我 */
navigate('#/me');
await sleep(250);
check('我页面显示微信号与退出演示', appText().includes('linxiaoman') && appText().includes('退出演示模式'));

console.log(`\n结果：${pass} 通过，${fail} 失败`);
process.exit(fail ? 1 : 0);
