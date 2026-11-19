/* 端到端验证：注册 -> 好友 -> 单聊 -> 群聊 -> WebSocket 实时推送 -> 已读 */
import WebSocket from 'ws';

const API = process.env.WETALK_URL || 'http://127.0.0.1:8080';
const suffix = Date.now().toString(36);

let pass = 0;
let fail = 0;

function check(name, cond, extra) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}${extra ? ' -> ' + JSON.stringify(extra) : ''}`);
  }
}

async function call(path, { method = 'GET', token, body } = {}) {
  const headers = {};
  if (body) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`${API}/api${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

function connect(token) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${API.replace('http', 'ws')}/ws?token=${token}`);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
    setTimeout(() => reject(new Error('ws connect timeout')), 4000);
  });
}

function waitFor(ws, type, ms = 4000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off('message', handler);
      reject(new Error(`等待 ${type} 超时`));
    }, ms);
    function handler(raw) {
      let m;
      try { m = JSON.parse(raw.toString()); } catch { return; }
      if (m.type !== type) return;
      clearTimeout(timer);
      ws.off('message', handler);
      resolve(m);
    }
    ws.on('message', handler);
  });
}

async function main() {
  console.log('\nWeTalk 端到端测试\n');

  // 1. 注册
  const alice = await call('/auth/register', {
    method: 'POST',
    body: { username: `alice_${suffix}`, password: 'secret123', nickname: '爱丽丝' },
  });
  const bob = await call('/auth/register', {
    method: 'POST',
    body: { username: `bob_${suffix}`, password: 'secret123', nickname: '鲍勃' },
  });
  check('注册两个账号', alice.status === 201 && bob.status === 201, [alice.status, bob.status]);

  const TA = alice.data.token;
  const TB = bob.data.token;
  const IA = alice.data.user?.id;
  const IB = bob.data.user?.id;
  check('拿到 token 与用户 id', Boolean(TA && TB && IA && IB));

  // 2. 鉴权
  const noAuth = await call('/me');
  check('未登录访问 /me 返回 401', noAuth.status === 401, noAuth.status);

  const wrongPw = await call('/auth/login', {
    method: 'POST',
    body: { username: `alice_${suffix}`, password: 'wrong-pass' },
  });
  check('错误密码登录被拒', wrongPw.status === 401, wrongPw.status);

  const relogin = await call('/auth/login', {
    method: 'POST',
    body: { username: `alice_${suffix}`, password: 'secret123' },
  });
  check('正确密码可登录', relogin.status === 200, relogin.status);

  // 3. 好友
  const search = await call(`/users/search?q=bob_${suffix}`, { token: TA });
  check('可搜索到用户', search.data.users?.some((u) => u.id === IB), search.data.users);

  await call('/contacts', { method: 'POST', token: TA, body: { userId: IB } });
  const bobContacts = await call('/contacts', { token: TB });
  check('收到好友申请', bobContacts.data.requests?.some((r) => r.id === IA), bobContacts.data.requests);

  await call('/contacts/accept', { method: 'POST', token: TB, body: { userId: IA } });
  const aliceContacts = await call('/contacts', { token: TA });
  check('接受后成为双向好友', aliceContacts.data.friends?.some((f) => f.id === IB), aliceContacts.data.friends);

  // 4. 单聊 + WebSocket 实时
  const dm = await call('/conversations', { method: 'POST', token: TA, body: { type: 'direct', userId: IB } });
  const CID = dm.data.conversation?.id;
  check('创建单聊会话', Boolean(CID), dm.data);

  const wsB = await connect(TB);
  const pending = waitFor(wsB, 'message');

  const sent = await call(`/conversations/${CID}/messages`, {
    method: 'POST', token: TA, body: { type: 'text', content: '你好 Bob，这是第一条消息' },
  });
  check('发送文字消息', sent.status === 201, sent);

  const pushed = await pending;
  check('对方实时收到消息', pushed.message?.content.includes('你好 Bob'), pushed.message);

  const reply = await call(`/conversations/${CID}/messages`, {
    method: 'POST', token: TB, body: { type: 'text', content: '收到，爱丽丝！' },
  });
  check('对方回复成功', reply.status === 201, reply);

  const history = await call(`/conversations/${CID}/messages`, { token: TB });
  check('历史消息按时间正序', history.data.messages?.length === 2 && history.data.messages[1].content.includes('爱丽丝'), history.data.messages);

  const aliceConvs = await call('/conversations', { token: TA });
  const dmView = aliceConvs.data.conversations?.find((c) => c.id === CID);
  check('会话列表显示对方昵称', dmView?.name === '鲍勃', dmView?.name);
  check('会话列表带最后一条消息', dmView?.lastMessage?.content.includes('爱丽丝'), dmView?.lastMessage);

  // 5. 群聊
  const group = await call('/conversations', {
    method: 'POST', token: TA, body: { type: 'group', name: '测试群', memberIds: [IB] },
  });
  const GID = group.data.conversation?.id;
  check('创建群聊', Boolean(GID), group.data);

  const groupPush = waitFor(wsB, 'message');
  await call(`/conversations/${GID}/messages`, {
    method: 'POST', token: TA, body: { type: 'text', content: '群里的大家好' },
  });
  const gp = await groupPush;
  check('群成员实时收到群消息', gp.message?.content === '群里的大家好', gp.message);

  const bobConvs = await call('/conversations', { token: TB });
  const groupView = bobConvs.data.conversations?.find((c) => c.id === GID);
  check('群信息正确', groupView?.type === 'group' && groupView?.name === '测试群', groupView);
  check('群消息计入未读', typeof groupView?.unread === 'number' && groupView.unread >= 1, groupView?.unread);

  // 6. 已读
  await call(`/conversations/${GID}/read`, { method: 'POST', token: TB });
  const bobConvs2 = await call('/conversations', { token: TB });
  const gv2 = bobConvs2.data.conversations?.find((c) => c.id === GID);
  check('标记已读后未读归零', gv2?.unread === 0, gv2?.unread);

  // 7. 越权
  const outsider = await call('/auth/register', {
    method: 'POST',
    body: { username: `eve_${suffix}`, password: 'secret123', nickname: '外人' },
  });
  const intrude = await call(`/conversations/${CID}/messages`, { token: outsider.data.token });
  check('非成员无法读取他人会话', intrude.status === 403, intrude.status);

  wsB.close();
  console.log(`\n结果：${pass} 通过，${fail} 失败\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('测试异常：', err);
  process.exit(1);
});
