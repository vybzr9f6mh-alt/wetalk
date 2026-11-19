/* WeTalk 前端 —— 无框架单页应用 */

const appEl = document.getElementById('app');
const toastEl = document.getElementById('toast');

const state = {
  token: localStorage.getItem('wt_token') || '',
  demo: localStorage.getItem('wt_demo') === '1',
  me: null,
  conversations: [],
  contacts: { friends: [], requests: [] },
  chat: { conv: null, messages: [], typingUntil: 0 },
  ws: null,
  wsTimer: null,
  baseTitle: 'WeTalk',
};

/* ============================================================ 工具函数 */

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function initials(name) {
  const s = String(name || '?').trim();
  if (!s) return '?';
  const first = [...s][0];
  return /[a-zA-Z]/.test(first) ? first.toUpperCase() : first;
}

function avatarFor(name, hue, cls = '') {
  return `<div class="avatar ${cls}" style="background:hsl(${hue ?? 200} 58% 56%)">${esc(initials(name))}</div>`;
}

/* 供 appendChild 使用的真实节点版本（messageNode 用） */
function avatarNode(name, hue, cls = '') {
  const d = document.createElement('div');
  d.className = 'avatar' + (cls ? ' ' + cls : '');
  d.style.background = `hsl(${hue ?? 200} 58% 56%)`;
  d.textContent = initials(name);
  return d;
}

function pad(n) { return String(n).padStart(2, '0'); }

function fmtListTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const day = 86400000;
  if (ts >= midnight) return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (ts >= midnight - day) return '昨天';
  if (ts >= midnight - 6 * day) return '星期' + '日一二三四五六'[d.getDay()];
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function fmtChatTime(ts) {
  const d = new Date(ts);
  const now = new Date();
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const day = 86400000;
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (ts >= midnight) return hm;
  if (ts >= midnight - day) return `昨天 ${hm}`;
  if (ts >= midnight - 6 * day) return `星期${'日一二三四五六'[d.getDay()]} ${hm}`;
  return `${d.getMonth() + 1}月${d.getDate()}日 ${hm}`;
}

let toastTimer = null;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.hidden = true; }, 2000);
}

/* 原生壳里页面来自本地，接口需要在别处：允许用户自己填后端地址 */
let serverBase = localStorage.getItem('wt_server') || '';
const isNativeShell = location.protocol === 'capacitor:' || location.protocol === 'file:';

function trimSlash(s) { return String(s || '').replace(/\/+$/, ''); }

function apiUrl(path) {
  return `${trimSlash(serverBase)}/api${path}`;
}

function absUrl(u) {
  if (!u) return u;
  if (/^(https?:|data:|blob:)/i.test(u)) return u;
  return serverBase ? trimSlash(serverBase) + u : u;
}

async function api(path, { method = 'GET', body, auth = true } = {}) {
  if (state.demo) return demoApi(path, { method, body });
  const headers = {};
  if (body) headers['content-type'] = 'application/json';
  if (auth && state.token) headers.authorization = `Bearer ${state.token}`;
  const res = await fetch(apiUrl(path), {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = {};
  try { data = await res.json(); } catch { /* 空响应 */ }
  if (!res.ok) {
    if (res.status === 401 && auth) { clearAuth(); throw new Error('登录已失效'); }
    throw new Error(data.error || `请求失败 (${res.status})`);
  }
  return data;
}

/* ============================================================ 演示模式
   没有后端也能完整体验：数据存在 localStorage，对方会自动回复。 */

function demoConvView(d, c) {
  const list = d.messages[c.id] || [];
  const last = list.length ? list[list.length - 1] : null;
  return {
    ...c,
    members: c.members || [d.me.id],
    lastMessage: last,
    lastMessageAt: last ? last.createdAt : (c.lastMessageAt || Date.now()),
    unread: c.unread || 0,
  };
}

function demoDefault() {
  const seed = window.DemoSeed;
  const clone = (o) => JSON.parse(JSON.stringify(o));
  return {
    me: clone(seed.users[0]),
    friends: seed.users.slice(1).map(clone),
    requests: [],
    conversations: clone(seed.conversations),
    messages: clone(seed.messages),
    moments: clone(seed.moments),
    nextMessageId: 5000,
    nextConvId: 900,
  };
}

function demoData() {
  let d = window.DemoStore.load();
  if (!d || !d.me) {
    d = demoDefault();
    window.DemoStore.save(d);
  }
  return d;
}

function demoSave(d) { window.DemoStore.save(d); }

function initDemo() {
  const d = demoData();
  state.me = d.me;
  state.conversations = d.conversations.map((c) => demoConvView(d, c));
  state.contacts = { friends: d.friends, requests: d.requests };
}

async function demoApi(path, { method = 'GET', body } = {}) {
  const d = demoData();
  const me = d.me;
  await new Promise((r) => setTimeout(r, 70));

  if (path === '/me') {
    if (method === 'PATCH' && body) {
      if (body.nickname) me.nickname = body.nickname;
      if (typeof body.signature === 'string') me.signature = body.signature;
      demoSave(d);
    }
    return { user: me };
  }

  if (path === '/contacts') {
    if (method === 'POST') return { ok: true };
    return { friends: d.friends, requests: d.requests };
  }

  if (path === '/conversations') {
    if (method === 'GET') {
      return { conversations: d.conversations.map((c) => demoConvView(d, c)) };
    }
    if (body && body.type === 'direct') {
      const peer = d.friends.find((f) => f.id === body.userId);
      const exist = d.conversations.find((c) => c.type === 'direct' && c.peerId === body.userId);
      if (exist) return { conversation: demoConvView(d, exist) };
      const conv = {
        id: ++d.nextConvId, type: 'direct', name: peer ? peer.nickname : '好友',
        avatarHue: peer ? peer.avatarHue : 200, peerId: body.userId,
        members: [me.id, body.userId], unread: 0, lastMessageAt: Date.now(),
      };
      d.conversations.unshift(conv);
      d.messages[conv.id] = [];
      demoSave(d);
      return { conversation: demoConvView(d, conv) };
    }
    if (body && body.type === 'group') {
      const ids = body.memberIds || [];
      const conv = {
        id: ++d.nextConvId, type: 'group',
        name: body.name || ids.map((id) => {
          const f = d.friends.find((x) => x.id === id);
          return f ? f.nickname : '?';
        }).join('、'),
        avatarHue: (d.nextConvId * 47) % 360,
        members: [me.id, ...ids], unread: 0, lastMessageAt: Date.now(),
      };
      d.conversations.unshift(conv);
      d.messages[conv.id] = [{
        id: ++d.nextMessageId, conversationId: conv.id, senderId: 0,
        sender: null, type: 'system', content: '你创建了群聊', createdAt: Date.now(),
      }];
      demoSave(d);
      return { conversation: demoConvView(d, conv) };
    }
  }

  const mConv = path.match(/^\/conversations\/(\d+)$/);
  if (mConv) {
    const c = d.conversations.find((x) => x.id === Number(mConv[1]));
    if (!c) throw new Error('会话不存在');
    return { conversation: demoConvView(d, c) };
  }

  const mRead = path.match(/^\/conversations\/(\d+)\/read$/);
  if (mRead) {
    const c = d.conversations.find((x) => x.id === Number(mRead[1]));
    if (c) c.unread = 0;
    demoSave(d);
    return { ok: true };
  }

  const mMessages = path.match(/^\/conversations\/(\d+)\/messages(?:\?.*)?$/);
  if (mMessages) {
    const cid = Number(mMessages[1]);
    const c = d.conversations.find((x) => x.id === cid);
    if (!c) throw new Error('会话不存在');
    if (method === 'GET') return { messages: d.messages[cid] || [] };

    if (body.type === 'image') throw new Error('演示模式暂不支持发送图片');
    const msg = {
      id: ++d.nextMessageId, conversationId: cid, senderId: me.id,
      sender: { id: me.id, nickname: me.nickname, avatarHue: me.avatarHue },
      type: 'text', content: String(body.content || '').slice(0, 2000),
      createdAt: Date.now(),
    };
    (d.messages[cid] || (d.messages[cid] = [])).push(msg);
    demoSave(d);

    const sc = state.conversations.find((x) => x.id === cid);
    if (sc) { sc.lastMessage = msg; sc.lastMessageAt = msg.createdAt; }

    const peerId = c.type === 'direct'
      ? c.peerId
      : c.members.find((id) => id !== me.id);
    const peer = d.friends.find((f) => f.id === peerId) || me;
    showTyping();
    setTimeout(() => {
      const dd = demoData();
      const replies = window.DemoSeed.replies;
      const reply = {
        id: ++dd.nextMessageId, conversationId: cid, senderId: peer.id,
        sender: { id: peer.id, nickname: peer.nickname, avatarHue: peer.avatarHue },
        type: 'text', content: replies[Math.floor(Math.random() * replies.length)],
        createdAt: Date.now(),
      };
      (dd.messages[cid] || (dd.messages[cid] = [])).push(reply);
      demoSave(dd);
      handleWs({ type: 'message', message: reply });
    }, 1400 + Math.random() * 1600);

    return { message: msg };
  }

  if (path.startsWith('/users/search')) {
    const q = new URLSearchParams(path.split('?')[1] || '').get('q') || '';
    const users = d.friends
      .filter((f) => f.nickname.includes(q) || f.username.includes(q))
      .map((f) => ({ ...f, isFriend: true }));
    return { users };
  }

  if (path === '/contacts/accept' || path === '/auth/logout') return { ok: true };
  if (path === '/upload') throw new Error('演示模式暂不支持上传图片');

  throw new Error('演示模式未实现：' + path);
}

function enterDemo() {
  localStorage.removeItem('wt_token');
  localStorage.setItem('wt_demo', '1');
  location.hash = '#/chats';
  location.reload();
}

function exitDemo() {
  localStorage.removeItem('wt_demo');
  localStorage.removeItem('wt_token');
  location.hash = '#/login';
  location.reload();
}

/* 朋友圈数据（演示模式） */
function demoMoments() {
  const d = demoData();
  return { data: d, moments: d.moments || [] };
}


function clearAuth() {
  state.token = '';
  state.demo = false;
  state.me = null;
  state.conversations = [];
  localStorage.removeItem('wt_token');
  localStorage.removeItem('wt_demo');
  if (state.ws) { try { state.ws.close(); } catch {} state.ws = null; }
  location.hash = '#/login';
}

function go(hash) {
  if (location.hash === hash) router();
  else location.hash = hash;
}

/* ============================================================ 实时通道 */

function connectWs() {
  if (!state.token) return;
  if (state.ws && (state.ws.readyState === WebSocket.OPEN || state.ws.readyState === WebSocket.CONNECTING)) return;

  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const wsBase = serverBase
    ? trimSlash(serverBase).replace(/^http/i, 'ws')
    : `${proto}://${location.host}`;
  const ws = new WebSocket(`${wsBase}/ws?token=${encodeURIComponent(state.token)}`);
  state.ws = ws;

  ws.onopen = () => {
    if (state.wsTimer) { clearTimeout(state.wsTimer); state.wsTimer = null; }
  };

  ws.onmessage = (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    handleWs(msg);
  };

  ws.onclose = () => {
    state.ws = null;
    if (!state.token) return;
    if (state.wsTimer) clearTimeout(state.wsTimer);
    state.wsTimer = setTimeout(connectWs, 2500);
  };

  ws.onerror = () => { try { ws.close(); } catch {} };
}

function wsSend(payload) {
  if (state.ws && state.ws.readyState === WebSocket.OPEN) {
    state.ws.send(JSON.stringify(payload));
  }
}

function handleWs(msg) {
  switch (msg.type) {
    case 'ready':
      break;

    case 'message': {
      const m = msg.message;
      if (state.chat.conv && state.chat.conv.id === m.conversationId) {
        state.chat.messages.push(m);
        appendMessageToDom(m);
        scrollToBottom();
        api(`/conversations/${m.conversationId}/read`, { method: 'POST' }).catch(() => {});
        updateConversationInPlace(m);
      } else {
        bumpConversationUnread(m);
      }
      break;
    }

    case 'typing': {
      if (state.chat.conv && state.chat.conv.id === msg.conversationId) {
        showTyping();
      }
      break;
    }

    case 'read': {
      break;
    }

    case 'contact:request':
      toast(`${msg.user.nickname} 请求添加你为朋友`);
      loadContacts();
      if (isTabView()) render();
      break;

    case 'contact:accepted':
      toast(`${msg.user.nickname} 已通过你的好友请求`);
      loadContacts();
      if (isTabView()) render();
      break;

    case 'conversation:new':
      refreshConversations();
      break;
  }
}

function isTabView() {
  return !state.chat.conv;
}

function bumpConversationUnread(m) {
  const c = state.conversations.find((x) => x.id === m.conversationId);
  if (!c) { refreshConversations(); return; }
  c.unread = (c.unread || 0) + 1;
  c.lastMessage = m;
  c.lastMessageAt = m.createdAt;
  if (isTabView()) render();
}

function updateConversationInPlace(m) {
  const c = state.conversations.find((x) => x.id === m.conversationId);
  if (!c) return;
  c.lastMessage = m;
  c.lastMessageAt = m.createdAt;
  if (state.chat.conv && state.chat.conv.id === m.conversationId) {
    c.unread = 0;
  }
}

function showTyping() {
  const box = document.querySelector('.chat .messages');
  if (!box) return;
  let el = box.querySelector('.typing');
  if (!el) {
    el = document.createElement('div');
    el.className = 'typing';
    box.appendChild(el);
  }
  el.textContent = '对方正在输入…';
  state.chat.typingUntil = Date.now() + 2500;
  clearTimeout(showTyping._t);
  showTyping._t = setTimeout(() => {
    if (Date.now() >= state.chat.typingUntil && el) el.remove();
  }, 2600);
  scrollToBottom();
}

/* ============================================================ 数据加载 */

async function loadMe() {
  const { user } = await api('/me');
  state.me = user;
}

async function loadConversations() {
  const { conversations } = await api('/conversations');
  state.conversations = conversations;
}

async function loadContacts() {
  state.contacts = await api('/contacts');
}

function refreshConversations() {
  if (!state.token) return;
  loadConversations().then(() => { if (isTabView()) render(); }).catch(() => {});
}

/* ============================================================ 图标 */

const ICON = {
  chat: '<path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5 8.4 8.4 0 0 1-3.9-.9L3 21l1.9-5.6A8.4 8.4 0 0 1 4 11.5 8.5 8.5 0 0 1 12.5 3 8.5 8.5 0 0 1 21 11.5Z"/>',
  contacts: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  discover: '<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2.2 5-5 2.2 2.2-5Z"/>',
  me: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1"/>',
  back: '<path d="M15 18l-6-6 6-6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
};

function svg(name, extra = '') {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" ${extra}>${ICON[name]}</svg>`;
}

/* ============================================================ 渲染 */

function tabbar(active) {
  const tabs = [
    ['chats', '微信', 'chat'],
    ['contacts', '通讯录', 'contacts'],
    ['discover', '发现', 'discover'],
    ['me', '我', 'me'],
  ];
  return `<nav class="tabbar">${tabs.map(([key, label, icon]) => `
    <a href="#/${key}" class="${active === key ? 'active' : ''}">${svg(icon)}<span>${label}</span></a>
  `).join('')}</nav>`;
}

function router() {
  const raw = location.hash.slice(1) || '/chats';
  const parts = raw.split('/').filter(Boolean);
  const head = parts[0] || 'chats';

  if (!state.token && !state.demo) return renderLogin();

  // 离开聊天页时清掉当前会话，避免影响 tab 视图与未读刷新
  if (head !== 'chat') state.chat.conv = null;

  if (head === 'login') { go('#/chats'); return; }
  if (!state.me) return renderLoading();

  if (head === 'chat' && parts[1]) return renderChat(Number(parts[1]));
  if (head === 'add') return renderAddFriend();
  if (head === 'requests') return renderRequests();
  if (head === 'newgroup') return renderNewGroup();
  if (head === 'chats') return renderChats();
  if (head === 'contacts') return renderContacts();
  if (head === 'discover') return renderDiscover();
  if (head === 'moments') return renderMoments();
  if (head === 'me') return renderMe();
  go('#/chats');
}

function renderLoading() {
  appEl.innerHTML = '<div class="spinner"></div>';
}

/* ---------------------------------------------------------------- 登录 */

let authMode = 'login';

function renderLogin() {
  appEl.innerHTML = `
    <div class="auth">
      <div class="brand">
        <div class="logo">${svg('chat', 'stroke="#fff" stroke-width="2"')}</div>
        <h2>${authMode === 'login' ? '登录 WeTalk' : '注册 WeTalk'}</h2>
        <p>${authMode === 'login' ? '一个属于你自己的即时通讯' : '只需用户名和密码'}</p>
      </div>
      <form id="authForm">
        <label class="field"><span>用户名</span>
          <input name="username" autocomplete="username" autocapitalize="none" placeholder="3-20 位字母、数字或下划线" required>
        </label>
        ${authMode === 'register' ? `
        <label class="field"><span>昵称</span>
          <input name="nickname" placeholder="别人看到的名字" maxlength="24">
        </label>` : ''}
        <label class="field"><span>密码</span>
          <input name="password" type="password" autocomplete="${authMode === 'login' ? 'current-password' : 'new-password'}" placeholder="至少 6 位" required>
        </label>
        <button class="btn block" type="submit">${authMode === 'login' ? '登录' : '注册并登录'}</button>
      </form>
      <div class="switch">
        ${authMode === 'login'
          ? '还没有账号？<button data-act="auth-mode" data-mode="register">注册</button>'
          : '已有账号？<button data-act="auth-mode" data-mode="login">登录</button>'}
      </div>
      <button class="demo-entry" data-act="enter-demo">
        不登录，先看看演示模式 →
      </button>
      <div style="margin-top:16px;text-align:center;font-size:12px;color:var(--muted)">
        服务器：
        <button data-act="server-config" style="border:0;background:none;color:#576b95;font:inherit;cursor:pointer;padding:0 2px">
          ${esc(serverBase || (isNativeShell ? '未设置 · 点此配置' : '当前站点'))}
        </button>
      </div>
    </div>`;
}

/* ---------------------------------------------------------------- 会话列表 */

function renderChats() {
  const list = state.conversations;
  const body = list.length === 0
    ? `<div class="empty">还没有聊天<br>去「通讯录」添加朋友吧</div>`
    : `<div class="list">${list.map(convRow).join('')}</div>`;

  appEl.innerHTML = `
    <div class="nav"><h1>微信</h1>
      <button class="side right" data-act="to-add" aria-label="添加">${svg('plus', 'width="22" height="22"')}</button>
    </div>
    <div class="page">${body}</div>
    ${tabbar('chats')}`;

  document.title = 'WeTalk';
}

function convRow(c) {
  const last = c.lastMessage;
  let preview = '';
  if (last) {
    if (last.type === 'image') preview = '[图片]';
    else if (last.type === 'system') preview = last.content;
    else {
      const prefix = c.type === 'group' && last.sender ? `${last.sender.nickname}：` : '';
      preview = prefix + last.content;
    }
  }
  return `
    <a class="row" href="#/chat/${c.id}">
      ${avatarFor(c.name, c.avatarHue)}
      <div class="body">
        <div class="title">
          <span class="name">${esc(c.name)}</span>
          <span class="time">${fmtListTime(c.lastMessageAt)}</span>
        </div>
        <div class="desc">${esc(preview)}</div>
      </div>
      <div class="trail">${c.unread > 0 ? `<span class="badge">${c.unread > 99 ? '99+' : c.unread}</span>` : ''}</div>
    </a>`;
}

/* ---------------------------------------------------------------- 通讯录 */

function renderContacts() {
  const { friends, requests } = state.contacts;
  const reqBadge = requests.length > 0 ? `<span class="badge">${requests.length}</span>` : '';

  appEl.innerHTML = `
    <div class="nav"><h1>通讯录</h1>
      <button class="side right" data-act="to-add" aria-label="添加">${svg('plus', 'width="22" height="22"')}</button>
    </div>
    <div class="page">
      <div class="list">
        <a class="row" href="#/requests">
          ${avatarFor('新', 205)}
          <div class="body"><div class="title"><span class="name">新的朋友</span></div></div>
          <div class="trail">${reqBadge}</div>
        </a>
        <a class="row" href="#/newgroup">
          ${avatarFor('群', 40)}
          <div class="body"><div class="title"><span class="name">群聊</span></div></div>
        </a>
      </div>
      ${friends.length === 0
        ? `<div class="hint">还没有好友<br>点击右上角 + 搜索用户名添加</div>`
        : `<div class="group-title">好友（${friends.length}）</div>
           <div class="list">${friends.map(friendRow).join('')}</div>`}
    </div>
    ${tabbar('contacts')}`;
  document.title = 'WeTalk';
}

function friendRow(f) {
  return `
    <button class="row" data-act="open-dm" data-id="${f.id}">
      ${avatarFor(f.nickname, f.avatarHue)}
      <div class="body">
        <div class="title"><span class="name">${esc(f.nickname)}</span></div>
        <div class="desc">${esc(f.signature || '@' + f.username)}</div>
      </div>
    </button>`;
}

/* ---------------------------------------------------------------- 新的朋友 */

function renderRequests() {
  const { requests } = state.contacts;
  const body = requests.length === 0
    ? `<div class="empty">暂无新的朋友申请</div>`
    : `<div class="list">${requests.map((r) => `
        <div class="row plain">
          ${avatarFor(r.nickname, r.avatarHue)}
          <div class="body">
            <div class="title"><span class="name">${esc(r.nickname)}</span></div>
            <div class="desc">@${esc(r.username)} 请求添加你为朋友</div>
          </div>
          <button class="btn small" data-act="accept" data-id="${r.id}">接受</button>
        </div>`).join('')}</div>`;

  appEl.innerHTML = `
    <div class="nav">
      <button class="side left" data-act="back">${svg('back', 'width="22" height="22"')}</button>
      <h1>新的朋友</h1>
    </div>
    <div class="page no-tab">${body}</div>`;
}

/* ---------------------------------------------------------------- 添加朋友 */

function renderAddFriend() {
  appEl.innerHTML = `
    <div class="nav">
      <button class="side left" data-act="back">${svg('back', 'width="22" height="22"')}</button>
      <h1>添加朋友</h1>
    </div>
    <div class="page no-tab">
      <div style="padding:14px 16px;background:var(--card)">
        <input id="searchInput" class="search" placeholder="搜索用户名或昵称"
          style="width:100%;height:40px;border:0;border-radius:8px;background:#f2f2f2;padding:0 12px;font:inherit;outline:none">
      </div>
      <div id="searchResults"></div>
    </div>`;

  const input = document.getElementById('searchInput');
  let timer = null;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (!q) { document.getElementById('searchResults').innerHTML = ''; return; }
    timer = setTimeout(() => doSearch(q), 280);
  });
  input.focus();
}

async function doSearch(q) {
  const box = document.getElementById('searchResults');
  if (!box) return;
  box.innerHTML = '<div class="spinner"></div>';
  try {
    const { users } = await api(`/users/search?q=${encodeURIComponent(q)}`);
    if (!users.length) {
      box.innerHTML = '<div class="empty">没有找到相关用户</div>';
      return;
    }
    box.innerHTML = `<div class="list">${users.map((u) => `
      <div class="row plain">
        ${avatarFor(u.nickname, u.avatarHue)}
        <div class="body">
          <div class="title"><span class="name">${esc(u.nickname)}</span></div>
          <div class="desc">@${esc(u.username)}</div>
        </div>
        ${u.isFriend
          ? '<span class="desc">已是好友</span>'
          : `<button class="btn small" data-act="add-contact" data-id="${u.id}">添加</button>`}
      </div>`).join('')}</div>`;
  } catch (err) {
    box.innerHTML = `<div class="empty">${esc(err.message)}</div>`;
  }
}

/* ---------------------------------------------------------------- 发起群聊 */

function renderNewGroup() {
  const { friends } = state.contacts;
  if (friends.length === 0) {
    appEl.innerHTML = `
      <div class="nav"><button class="side left" data-act="back">${svg('back', 'width="22" height="22"')}</button><h1>发起群聊</h1></div>
      <div class="page no-tab"><div class="empty">先添加好友，才能建群</div></div>`;
    return;
  }
  appEl.innerHTML = `
    <div class="nav">
      <button class="side left" data-act="back">${svg('back', 'width="22" height="22"')}</button>
      <h1>发起群聊</h1>
      <button class="side right" data-act="create-group" id="createGroupBtn" disabled>完成</button>
    </div>
    <div class="page no-tab">
      <div style="padding:14px 16px;background:var(--card)">
        <input id="groupName" placeholder="群名称（可选，默认用成员昵称组合）" maxlength="24"
          style="width:100%;height:40px;border:0;border-radius:8px;background:#f2f2f2;padding:0 12px;font:inherit;outline:none">
      </div>
      <div class="list">${friends.map((f) => `
        <button class="row plain" data-act="toggle-member" data-id="${f.id}">
          <span class="check" data-check="${f.id}"></span>
          ${avatarFor(f.nickname, f.avatarHue)}
          <div class="body"><div class="title"><span class="name">${esc(f.nickname)}</span></div></div>
        </button>`).join('')}</div>
    </div>`;
  state.picked = new Set();
}

/* ---------------------------------------------------------------- 发现 */

function renderDiscover() {
  const items = [
    ['moments', '朋友圈', '◉', '#f0a020'],
    ['channels', '视频号', '▷', '#f0a020'],
    ['live', '直播', '◈', '#fa5151'],
    ['scan', '扫一扫', '▣', '#07c160'],
    ['shake', '摇一摇', '↻', '#576b95'],
    ['topics', '看一看', '⌕', '#576b95'],
    ['search', '搜一搜', '⌕', '#576b95'],
    ['nearby', '附近', '◎', '#576b95'],
    ['shopping', '购物', '▤', '#fa5151'],
    ['games', '游戏', '◈', '#07c160'],
    ['mini', '小程序', '⊞', '#07c160'],
  ];

  appEl.innerHTML = `
    <div class="nav"><h1>发现</h1></div>
    <div class="page">
      <div class="list disc-list">
        ${items.map(([act, label, glyph, color]) => `
          <button class="cell" data-act="${act === 'moments' ? 'open-moments' : 'soon'}">
            <span class="disc-icon" style="background:${color}">${glyph}</span>
            <span class="grow">${label}</span>
            <span class="chev">›</span>
          </button>`).join('')}
      </div>
    </div>
    ${tabbar('discover')}`;
  document.title = 'WeTalk';
}

/* ---------------------------------------------------------------- 朋友圈 */

function renderMoments() {
  const { data, moments } = demoMoments();
  const me = data.me;
  const users = data.friends;
  const findUser = (id) => (id === me.id ? me : (users.find((u) => u.id === id) || { nickname: '?' }));
  const sorted = [...moments].sort((a, b) => b.time - a.time);

  appEl.innerHTML = `
    <div class="nav solid">
      <button class="side left" data-act="back">${svg('back', 'width="22" height="22"')}</button>
      <h1>朋友圈</h1>
      <button class="side right icon-btn" data-act="publish-moment" aria-label="发表">${svg('camera', 'width="22" height="22"')}</button>
    </div>
    <div class="page no-tab moments-page">
      <div class="moments-cover">
        <div class="cover-bg"></div>
        <div class="cover-person">
          ${avatarFor(me.nickname, me.avatarHue, 'lg')}
          <div class="cover-name">${esc(me.nickname)}</div>
        </div>
      </div>
      <div class="moments-list">
        ${sorted.length ? sorted.map((m) => momentCard(m, findUser, me)).join('') : '<div class="empty">还没有动态</div>'}
      </div>
    </div>`;
  document.title = '朋友圈';
}

function momentCard(m, findUser, me) {
  const u = findUser(m.authorId);
  const likes = (m.likes || []).map(findUser);
  const comments = m.comments || [];
  const liked = (m.likes || []).includes(me.id);

  return `
    <div class="moment">
      ${avatarFor(u.nickname, u.avatarHue)}
      <div class="moment-body">
        <div class="moment-name">${esc(u.nickname)}</div>
        ${m.text ? `<div class="moment-text">${esc(m.text)}</div>` : ''}
        ${m.images && m.images.length ? `
          <div class="moment-grid g${Math.min(m.images.length, 9)}">
            ${m.images.map((h, i) => `<div class="mimg" style="--h:${h};--i:${i}"></div>`).join('')}
          </div>` : ''}
        <div class="moment-meta">
          <span class="moment-time">${fmtListTime(m.time)}</span>
          <button class="moment-act ${liked ? 'on' : ''}" data-act="like-moment" data-id="${m.id}">${liked ? '取消' : '赞'}</button>
          <button class="moment-act" data-act="comment-moment" data-id="${m.id}">评论</button>
        </div>
        ${likes.length || comments.length ? `
          <div class="moment-social">
            ${likes.length ? `<div class="likes">♥ ${likes.map((x) => esc(x.nickname)).join('、')}</div>` : ''}
            ${comments.map((c) => `<div class="comment"><b>${esc(findUser(c.userId).nickname)}</b>：${esc(c.text)}</div>`).join('')}
          </div>` : ''}
      </div>
    </div>`;
}

function publishMoment() {
  const text = prompt('这一刻的想法…');
  if (text === null) return;
  const t = text.trim();
  if (!t) return;
  const d = demoData();
  d.moments = d.moments || [];
  d.moments.unshift({
    id: Date.now(), authorId: d.me.id, time: Date.now(),
    text: t, images: [], likes: [], comments: [],
  });
  demoSave(d);
  toast('已发表');
  renderMoments();
}

function toggleLike(id) {
  const d = demoData();
  const m = (d.moments || []).find((x) => x.id === id);
  if (!m) return;
  m.likes = m.likes || [];
  const idx = m.likes.indexOf(d.me.id);
  if (idx >= 0) m.likes.splice(idx, 1);
  else m.likes.push(d.me.id);
  demoSave(d);
  renderMoments();
}

function addComment(id) {
  const text = prompt('评论：');
  if (!text || !text.trim()) return;
  const d = demoData();
  const m = (d.moments || []).find((x) => x.id === id);
  if (!m) return;
  m.comments = m.comments || [];
  m.comments.push({ userId: d.me.id, text: text.trim().slice(0, 200) });
  demoSave(d);
  renderMoments();
}

/* ---------------------------------------------------------------- 我 */

function renderMe() {
  const u = state.me;
  const demo = state.demo;
  appEl.innerHTML = `
    <div class="nav"><h1>我</h1></div>
    <div class="page">
      <div class="profile-head">
        ${avatarFor(u.nickname, u.avatarHue, 'lg')}
        <div class="info">
          <div class="nick">${esc(u.nickname)}</div>
          <div class="sub">微信号：${esc(u.username)}</div>
          ${u.signature ? `<div class="sub">${esc(u.signature)}</div>` : ''}
        </div>
        <span class="qr">▦</span>
      </div>
      <div class="list me-list">
        <button class="cell" data-act="soon"><span class="grow">支付</span><span class="chev">›</span></button>
        <button class="cell" data-act="open-moments"><span class="grow">朋友圈</span><span class="chev">›</span></button>
        <button class="cell" data-act="soon"><span class="grow">收藏</span><span class="chev">›</span></button>
        <button class="cell" data-act="soon"><span class="grow">卡包</span><span class="chev">›</span></button>
        <button class="cell" data-act="soon"><span class="grow">表情</span><span class="chev">›</span></button>
      </div>
      <div class="list me-list">
        <button class="cell" data-act="edit-profile"><span class="grow">设置与资料</span><span class="chev">›</span></button>
        ${demo
          ? '<button class="cell" data-act="exit-demo"><span class="grow" style="color:var(--red)">退出演示模式</span></button>'
          : '<button class="cell" data-act="logout"><span class="grow" style="color:var(--red)">退出登录</span></button>'}
      </div>
      <div class="hint">WeTalk v1.0${demo ? ' · 演示模式' : ' · 自建即时通讯'}</div>
    </div>
    ${tabbar('me')}`;
  document.title = '我';
}

/* ---------------------------------------------------------------- 聊天 */

async function renderChat(id) {
  if (!Number.isInteger(id) || id <= 0) return go('#/chats');

  let conv = state.conversations.find((c) => c.id === id);
  if (!conv) {
    try {
      const r = await api(`/conversations/${id}`);
      conv = r.conversation;
    } catch (err) {
      toast(err.message);
      return go('#/chats');
    }
  }

  state.chat.conv = conv;
  state.chat.messages = [];

  const subtitle = conv.type === 'group' ? `群聊 · ${conv.members.length} 人` : '';

  appEl.innerHTML = `
    <div class="chat">
      <div class="nav solid">
        <button class="side left" data-act="back-to-chats">${svg('back', 'width="22" height="22"')}</button>
        <h1>${esc(conv.name)}${subtitle ? `<small style="font-weight:400;color:var(--muted);font-size:12px"> ${esc(subtitle)}</small>` : ''}</h1>
      </div>
      <div class="messages" id="messages"></div>
      <div class="composer">
        <button class="icon-btn-round" data-act="pick-image" aria-label="发送图片">${svg('image', 'width="22" height="22"')}</button>
        <textarea id="composerInput" rows="1" placeholder="发消息…"></textarea>
        <button class="btn" data-act="send" id="sendBtn">发送</button>
      </div>
    </div>`;

  document.title = `${conv.name} - WeTalk`;

  const input = document.getElementById('composerInput');
  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 110) + 'px';
    wsSend({ type: 'typing', conversationId: conv.id });
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      sendCurrentMessage();
    }
  });

  try {
    const { messages } = await api(`/conversations/${id}/messages?limit=60`);
    state.chat.messages = messages;
    paintMessages(messages);
    scrollToBottom(false);
    api(`/conversations/${id}/read`, { method: 'POST' }).catch(() => {});
    conv.unread = 0;
  } catch (err) {
    toast(err.message);
  }

  connectWs();
}

function paintMessages(messages) {
  const box = document.getElementById('messages');
  if (!box) return;
  box.innerHTML = '';
  let prevTs = 0;
  for (const m of messages) {
    if (m.createdAt - prevTs > 5 * 60 * 1000) {
      const sep = document.createElement('div');
      sep.className = 'time-sep';
      sep.textContent = fmtChatTime(m.createdAt);
      box.appendChild(sep);
    }
    prevTs = m.createdAt;
    box.appendChild(messageNode(m));
  }
}

function messageNode(m) {
  if (m.type === 'system') {
    const el = document.createElement('div');
    el.className = 'sys';
    el.textContent = m.content;
    return el;
  }

  const mine = m.senderId === state.me.id;
  const isGroup = state.chat.conv && state.chat.conv.type === 'group';
  const wrap = document.createElement('div');
  wrap.className = 'msg' + (mine ? ' mine' : '');
  wrap.dataset.msgId = m.id;

  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  if (m.type === 'image') {
    const img = document.createElement('img');
    img.src = absUrl(m.content);
    img.alt = '图片';
    img.loading = 'lazy';
    bubble.appendChild(img);
  } else {
    bubble.textContent = m.content;
  }

  if (isGroup && !mine) {
    const stack = document.createElement('div');
    stack.className = 'stack';
    const who = document.createElement('div');
    who.className = 'who';
    who.textContent = m.sender ? m.sender.nickname : '';
    stack.appendChild(who);
    stack.appendChild(bubble);
    wrap.appendChild(avatarNode(m.sender?.nickname, m.sender?.avatarHue));
    wrap.appendChild(stack);
  } else {
    wrap.appendChild(avatarNode(mine ? state.me.nickname : (state.chat.conv?.name ?? '?'), mine ? state.me.avatarHue : state.chat.conv?.avatarHue));
    wrap.appendChild(bubble);
  }
  return wrap;
}

function appendMessageToDom(m) {
  const box = document.getElementById('messages');
  if (!box) return;
  const prev = state.chat.messages[state.chat.messages.length - 2];
  if (!prev || m.createdAt - prev.createdAt > 5 * 60 * 1000) {
    const sep = document.createElement('div');
    sep.className = 'time-sep';
    sep.textContent = fmtChatTime(m.createdAt);
    box.appendChild(sep);
  }
  box.appendChild(messageNode(m));
}

function scrollToBottom(smooth = true) {
  const box = document.getElementById('messages');
  if (!box) return;
  box.scrollTo({ top: box.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
}

async function sendCurrentMessage() {
  const input = document.getElementById('composerInput');
  if (!input) return;
  const text = input.value.trim();
  if (!text || !state.chat.conv) return;
  input.value = '';
  input.style.height = 'auto';
  await postMessage('text', text);
}

async function postMessage(type, content) {
  const conv = state.chat.conv;
  if (!conv) return;
  try {
    const { message } = await api(`/conversations/${conv.id}/messages`, {
      method: 'POST',
      body: { type, content },
    });
    state.chat.messages.push(message);
    appendMessageToDom(message);
    scrollToBottom();
  } catch (err) {
    toast(err.message);
  }
}

/* ---------------------------------------------------------------- 图片 */

async function pickAndSendImage() {
  const conv = state.chat.conv;
  if (!conv) return;
  const file = await chooseFile('image/*');
  if (!file) return;
  if (file.size > 6 * 1024 * 1024) return toast('图片超过 6MB');
  try {
    const dataUrl = await readAsDataUrl(file);
    const { url } = await api('/upload', { method: 'POST', body: { dataUrl } });
    await postMessage('image', url);
  } catch (err) {
    toast(err.message);
  }
}

function chooseFile(accept) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.style.display = 'none';
    document.body.appendChild(input);
    input.addEventListener('change', () => {
      const f = input.files && input.files[0] ? input.files[0] : null;
      input.remove();
      resolve(f);
    });
    input.click();
  });
}

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error('读取图片失败'));
    r.readAsDataURL(file);
  });
}

/* ============================================================ 交互 */

document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;

  switch (act) {
    case 'auth-mode':
      authMode = el.dataset.mode === 'register' ? 'register' : 'login';
      renderLogin();
      break;

    case 'server-config':
      openServerSheet();
      break;

    case 'back':
      if (history.length > 1) history.back();
      else go('#/chats');
      break;

    case 'back-to-chats':
      state.chat.conv = null;
      go('#/chats');
      break;

    case 'to-add':
      go('#/add');
      break;

    case 'open-dm': {
      const peerId = Number(el.dataset.id);
      try {
        const { conversation } = await api('/conversations', { method: 'POST', body: { type: 'direct', userId: peerId } });
        const idx = state.conversations.findIndex((c) => c.id === conversation.id);
        if (idx === -1) state.conversations.unshift(conversation);
        go(`#/chat/${conversation.id}`);
      } catch (err) { toast(err.message); }
      break;
    }

    case 'add-contact': {
      try {
        await api('/contacts', { method: 'POST', body: { userId: Number(el.dataset.id) } });
        toast('已发送好友申请');
        el.textContent = '已申请';
        el.disabled = true;
      } catch (err) { toast(err.message); }
      break;
    }

    case 'accept': {
      try {
        await api('/contacts/accept', { method: 'POST', body: { userId: Number(el.dataset.id) } });
        toast('已添加为好友');
        await loadContacts();
        renderRequests();
      } catch (err) { toast(err.message); }
      break;
    }

    case 'toggle-member': {
      const id = Number(el.dataset.id);
      if (!state.picked) state.picked = new Set();
      if (state.picked.has(id)) state.picked.delete(id);
      else state.picked.add(id);
      const check = el.querySelector('.check');
      if (check) {
        check.classList.toggle('on', state.picked.has(id));
        check.textContent = state.picked.has(id) ? '✓' : '';
      }
      const btn = document.getElementById('createGroupBtn');
      if (btn) btn.disabled = state.picked.size === 0;
      break;
    }

    case 'create-group': {
      const nameInput = document.getElementById('groupName');
      const ids = [...(state.picked || [])];
      if (!ids.length) return;
      let name = (nameInput?.value || '').trim();
      if (!name) name = ids.map((id) => state.contacts.friends.find((f) => f.id === id)?.nickname || '?').join('、').slice(0, 24);
      try {
        const { conversation } = await api('/conversations', { method: 'POST', body: { type: 'group', name, memberIds: ids } });
        state.conversations.unshift(conversation);
        go(`#/chat/${conversation.id}`);
      } catch (err) { toast(err.message); }
      break;
    }

    case 'send':
      await sendCurrentMessage();
      break;

    case 'pick-image':
      await pickAndSendImage();
      break;

    case 'soon':
      toast('这个功能留给后续版本');
      break;

    case 'enter-demo':
      enterDemo();
      break;

    case 'exit-demo':
      exitDemo();
      break;

    case 'open-moments':
      go('#/moments');
      break;

    case 'publish-moment':
      publishMoment();
      break;

    case 'like-moment':
      toggleLike(Number(el.dataset.id));
      break;

    case 'comment-moment':
      addComment(Number(el.dataset.id));
      break;

    case 'edit-profile':
      await openProfileSheet();
      break;

    case 'logout':
      try { await api('/auth/logout', { method: 'POST' }); } catch {}
      clearAuth();
      break;
  }
});

document.addEventListener('submit', async (e) => {
  if (e.target.id !== 'authForm') return;
  e.preventDefault();
  const form = e.target;
  const btn = form.querySelector('button[type=submit]');
  const fd = new FormData(form);
  const username = String(fd.get('username') || '').trim();
  const password = String(fd.get('password') || '');
  const nickname = String(fd.get('nickname') || '').trim();

  btn.disabled = true;
  try {
    const path = authMode === 'login' ? '/auth/login' : '/auth/register';
    const body = authMode === 'login' ? { username, password } : { username, password, nickname };
    const { token, user } = await api(path, { method: 'POST', body, auth: false });
    state.token = token;
    state.me = user;
    localStorage.setItem('wt_token', token);
    await Promise.all([loadConversations(), loadContacts()]);
    connectWs();
    go('#/chats');
  } catch (err) {
    toast(err.message);
    btn.disabled = false;
  }
});

/* ---------------------------------------------------------------- 资料编辑 */

function openProfileSheet() {
  return new Promise((resolve) => {
    const mask = document.createElement('div');
    mask.className = 'sheet-mask';
    mask.innerHTML = `
      <div class="sheet">
        <h3>编辑资料</h3>
        <label class="field"><span>昵称</span>
          <input id="pNick" maxlength="24" value="${esc(state.me.nickname)}"
            style="width:100%;height:44px;border:1px solid var(--line);border-radius:8px;padding:0 12px;font:inherit;outline:none">
        </label>
        <label class="field"><span>个性签名</span>
          <input id="pSign" maxlength="80" value="${esc(state.me.signature || '')}" placeholder="介绍一下自己"
            style="width:100%;height:44px;border:1px solid var(--line);border-radius:8px;padding:0 12px;font:inherit;outline:none">
        </label>
        <div class="actions">
          <button class="btn ghost block" data-sheet="cancel">取消</button>
          <button class="btn block" data-sheet="save">保存</button>
        </div>
      </div>`;

    const close = () => { mask.remove(); resolve(); };
    mask.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-sheet]');
      if (!btn) { if (e.target === mask) close(); return; }
      if (btn.dataset.sheet === 'cancel') return close();
      const nickname = mask.querySelector('#pNick').value.trim();
      const signature = mask.querySelector('#pSign').value.trim();
      try {
        const { user } = await api('/me', { method: 'PATCH', body: { nickname, signature } });
        state.me = user;
        toast('已保存');
        close();
        renderMe();
      } catch (err) { toast(err.message); }
    });
    document.body.appendChild(mask);
    mask.querySelector('#pNick').focus();
  });
}

/* ---------------------------------------------------------------- 服务器设置 */

function openServerSheet() {
  const mask = document.createElement('div');
  mask.className = 'sheet-mask';
  mask.innerHTML = `
    <div class="sheet">
      <h3>服务器地址</h3>
      <p style="margin:-6px 0 14px;font-size:13px;color:var(--muted);text-align:center;line-height:1.5">
        填写 WeTalk 后端地址，例如 https://wetalk.example.com<br>网页版留空即使用当前站点
      </p>
      <input id="srvInput" value="${esc(serverBase)}" placeholder="留空则使用当前站点"
        style="width:100%;height:44px;border:1px solid var(--line);border-radius:8px;padding:0 12px;font:inherit;outline:none;background:#fff">
      <div class="actions">
        <button class="btn ghost block" data-sheet="cancel">取消</button>
        <button class="btn block" data-sheet="save">保存并重载</button>
      </div>
    </div>`;

  const close = () => mask.remove();
  mask.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-sheet]');
    if (!btn) { if (e.target === mask) close(); return; }
    if (btn.dataset.sheet === 'cancel') return close();
    const v = trimSlash(mask.querySelector('#srvInput').value.trim());
    if (v && !/^https?:\/\//i.test(v)) { toast('地址需以 http:// 或 https:// 开头'); return; }
    if (v) localStorage.setItem('wt_server', v);
    else localStorage.removeItem('wt_server');
    serverBase = v;
    location.reload();
  });
  document.body.appendChild(mask);
  mask.querySelector('#srvInput').focus();
}

/* ============================================================ 启动 */

async function boot() {
  if (state.demo) {
    initDemo();
    router();
    window.addEventListener('hashchange', router);
    return;
  }

  if (state.token) {
    try {
      await loadMe();
      await Promise.all([loadConversations(), loadContacts()]);
      connectWs();
    } catch {
      clearAuth();
    }
  }
  router();
  window.addEventListener('hashchange', router);

  if (!isNativeShell && location.protocol.startsWith('http') && navigator.serviceWorker?.register) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }

  if (isNativeShell && !serverBase) {
    setTimeout(() => toast('没有服务器？登录页可进入演示模式'), 500);
  }
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && state.token) {
      connectWs();
      refreshConversations();
    }
  });
}

boot();
