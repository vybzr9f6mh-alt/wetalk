import { mkdirSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { hashPassword, verifyPassword, newToken, validUsername, validPassword } from './auth.js';
import { isMember, memberIds, getOrCreateDirect, publicUser } from './db.js';

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const MAX_BODY = 12 * 1024 * 1024; // 12MB, base64 图片足够
const MAX_UPLOAD = 6 * 1024 * 1024;

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  res.end(body);
  return true;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new HttpError(413, '请求体过大'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new HttpError(400, 'JSON 格式错误'));
      }
    });
    req.on('error', reject);
  });
}

/* ------------------------------------------------------------------ 会话视图 */

function lastMessageOf(db, cid) {
  const row = db
    .prepare(
      `SELECT m.id, m.conversation_id, m.sender_id, m.type, m.content, m.created_at,
              u.nickname AS sn, u.avatar_hue AS sh
         FROM messages m JOIN users u ON u.id = m.sender_id
        WHERE m.conversation_id = ?
        ORDER BY m.id DESC LIMIT 1`
    )
    .get(cid);
  return row ? mapMessage(row) : null;
}

function mapMessage(row) {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    senderId: row.sender_id,
    type: row.type,
    content: row.content,
    createdAt: row.created_at,
    sender: row.sn ? { id: row.sender_id, nickname: row.sn, avatarHue: row.sh } : null,
  };
}

function conversationView(db, cid, userId) {
  const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(cid);
  if (!conv) return null;

  const members = db
    .prepare(
      `SELECT u.* FROM conversation_members cm JOIN users u ON u.id = cm.user_id
        WHERE cm.conversation_id = ? ORDER BY cm.joined_at`
    )
    .all(cid);

  const me = db.prepare('SELECT * FROM conversation_members WHERE conversation_id = ? AND user_id = ?').get(cid, userId);
  const peer = conv.type === 'direct' ? members.find((m) => m.id !== userId) : null;

  const unread = db
    .prepare(
      `SELECT COUNT(*) AS n FROM messages
        WHERE conversation_id = ? AND id > ? AND sender_id != ?`
    )
    .get(cid, me ? me.last_read_id : 0, userId).n;

  return {
    id: conv.id,
    type: conv.type,
    name: conv.type === 'group' ? conv.name : peer ? peer.nickname : '未知',
    avatarHue: conv.type === 'group' ? (conv.id * 47) % 360 : peer ? peer.avatar_hue : 200,
    peerId: peer ? peer.id : null,
    ownerId: conv.owner_id,
    members: members.map(publicUser),
    unread,
    lastMessage: lastMessageOf(db, cid),
    lastMessageAt: conv.last_message_at,
  };
}

/* ------------------------------------------------------------------ 业务处理 */

function register({ db, res, body }) {
  const username = String(body.username || '').trim();
  const password = String(body.password || '');
  const nickname = String(body.nickname || '').trim() || username;

  if (!validUsername(username)) throw new HttpError(400, '用户名需为 3-20 位字母、数字或下划线');
  if (!validPassword(password)) throw new HttpError(400, '密码需 6-64 位');
  if (nickname.length > 24) throw new HttpError(400, '昵称过长');

  const dup = db.prepare('SELECT 1 AS ok FROM users WHERE username = ?').get(username);
  if (dup) throw new HttpError(409, '该用户名已被注册');

  const now = Date.now();
  const info = db
    .prepare('INSERT INTO users (username, password_hash, nickname, avatar_hue, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(username, hashPassword(password), nickname, Math.floor(Math.random() * 360), now);

  const userId = Number(info.lastInsertRowid);
  const token = newToken();
  db.prepare('INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)').run(token, userId, now);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  sendJson(res, 201, { token, user: publicUser(user) });
}

function login({ db, res, body }) {
  const username = String(body.username || '').trim();
  const password = String(body.password || '');
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !verifyPassword(password, user.password_hash)) {
    throw new HttpError(401, '用户名或密码错误');
  }
  const token = newToken();
  const now = Date.now();
  db.prepare('INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)').run(token, user.id, now);
  db.prepare('UPDATE users SET last_seen = ? WHERE id = ?').run(now, user.id);
  sendJson(res, 200, { token, user: publicUser(user) });
}

function logout({ db, req, res }) {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(req.token);
  sendJson(res, 200, { ok: true });
}

function me({ res, user }) {
  sendJson(res, 200, { user: publicUser(user) });
}

function updateMe({ db, res, user, body }) {
  const nickname = body.nickname === undefined ? user.nickname : String(body.nickname).trim();
  const signature = body.signature === undefined ? user.signature : String(body.signature).slice(0, 80);
  if (!nickname || nickname.length > 24) throw new HttpError(400, '昵称需为 1-24 个字符');
  db.prepare('UPDATE users SET nickname = ?, signature = ? WHERE id = ?').run(nickname, signature, user.id);
  const fresh = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
  sendJson(res, 200, { user: publicUser(fresh) });
}

function searchUsers({ db, res, user, url }) {
  const q = String(url.searchParams.get('q') || '').trim();
  if (!q) return sendJson(res, 200, { users: [] });
  const rows = db
    .prepare(
      `SELECT * FROM users
        WHERE id != ? AND (username LIKE ? OR nickname LIKE ?)
        ORDER BY username LIMIT 20`
    )
    .all(user.id, `%${q}%`, `%${q}%`);
  const friendIds = new Set(
    db.prepare("SELECT contact_id FROM contacts WHERE user_id = ? AND status = 'accepted'").all(user.id).map((r) => r.contact_id)
  );
  sendJson(res, 200, {
    users: rows.map((r) => ({ ...publicUser(r), isFriend: friendIds.has(r.id) })),
  });
}

function contacts({ db, res, user }) {
  const friends = db
    .prepare(
      `SELECT u.*, c.created_at AS since FROM contacts c JOIN users u ON u.id = c.contact_id
        WHERE c.user_id = ? AND c.status = 'accepted' ORDER BY u.nickname`
    )
    .all(user.id);
  const requests = db
    .prepare(
      `SELECT u.*, c.created_at AS requested_at FROM contacts c JOIN users u ON u.id = c.user_id
        WHERE c.contact_id = ? AND c.status = 'pending' ORDER BY c.created_at DESC`
    )
    .all(user.id);
  sendJson(res, 200, {
    friends: friends.map((r) => ({ ...publicUser(r), since: r.since })),
    requests: requests.map((r) => ({ ...publicUser(r), requestedAt: r.requested_at })),
  });
}

function addContact({ db, res, user, body, sendToUser }) {
  const targetId = Number(body.userId);
  if (!Number.isInteger(targetId) || targetId === user.id) throw new HttpError(400, '参数错误');
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(targetId);
  if (!target) throw new HttpError(404, '用户不存在');

  const mine = db.prepare('SELECT * FROM contacts WHERE user_id = ? AND contact_id = ?').get(user.id, targetId);
  if (mine && mine.status === 'accepted') throw new HttpError(409, '你们已经是好友');

  const now = Date.now();
  // 对方已经申请过我 -> 直接成为好友
  const theirs = db.prepare('SELECT * FROM contacts WHERE user_id = ? AND contact_id = ?').get(targetId, user.id);
  if (theirs && theirs.status === 'pending') {
    db.prepare('UPDATE contacts SET status = ? WHERE id = ?').run('accepted', theirs.id);
    db.prepare('UPDATE contacts SET status = ? WHERE id = ?').run('accepted', mine.id);
    sendToUser(targetId, { type: 'contact:accepted', user: publicUser(user) });
    return sendJson(res, 200, { ok: true, accepted: true });
  }

  if (!mine) {
    db.prepare('INSERT INTO contacts (user_id, contact_id, status, created_at) VALUES (?, ?, ?, ?)').run(
      user.id, targetId, 'pending', now
    );
  }
  sendToUser(targetId, { type: 'contact:request', user: publicUser(user) });
  sendJson(res, 200, { ok: true, accepted: false });
}

function acceptContact({ db, res, user, body, sendToUser }) {
  const fromId = Number(body.userId);
  const req = db.prepare('SELECT * FROM contacts WHERE user_id = ? AND contact_id = ? AND status = ?').get(fromId, user.id, 'pending');
  if (!req) throw new HttpError(404, '没有该好友申请');
  const now = Date.now();
  db.prepare('UPDATE contacts SET status = ? WHERE id = ?').run('accepted', req.id);
  const reverse = db.prepare('SELECT * FROM contacts WHERE user_id = ? AND contact_id = ?').get(user.id, fromId);
  if (reverse) db.prepare('UPDATE contacts SET status = ? WHERE id = ?').run('accepted', reverse.id);
  else db.prepare('INSERT INTO contacts (user_id, contact_id, status, created_at) VALUES (?, ?, ?, ?)').run(user.id, fromId, 'accepted', now);

  sendToUser(fromId, { type: 'contact:accepted', user: publicUser(user) });
  sendJson(res, 200, { ok: true });
}

function rejectContact({ db, res, user, body }) {
  const fromId = Number(body.userId);
  db.prepare('DELETE FROM contacts WHERE user_id = ? AND contact_id = ? AND status = ?').run(fromId, user.id, 'pending');
  sendJson(res, 200, { ok: true });
}

function listConversations({ db, res, user }) {
  const rows = db
    .prepare(
      `SELECT c.id FROM conversations c JOIN conversation_members cm ON cm.conversation_id = c.id
        WHERE cm.user_id = ? ORDER BY c.last_message_at DESC, c.id DESC`
    )
    .all(user.id);
  sendJson(res, 200, { conversations: rows.map((r) => conversationView(db, r.id, user.id)).filter(Boolean) });
}

function createConversation({ db, res, user, body, sendToUsers }) {
  const type = body.type;
  if (type === 'direct') {
    const peerId = Number(body.userId);
    const peer = db.prepare('SELECT * FROM users WHERE id = ?').get(peerId);
    if (!peer) throw new HttpError(404, '用户不存在');
    if (peerId === user.id) throw new HttpError(400, '不能和自己聊天');
    const cid = getOrCreateDirect(db, user.id, peerId);
    return sendJson(res, 200, { conversation: conversationView(db, cid, user.id) });
  }

  if (type === 'group') {
    const name = String(body.name || '').trim().slice(0, 24);
    if (!name) throw new HttpError(400, '请填写群名称');
    const ids = Array.isArray(body.memberIds) ? [...new Set(body.memberIds.map(Number).filter(Number.isInteger))] : [];
    const members = ids.filter((id) => id !== user.id);
    if (members.length < 1) throw new HttpError(400, '至少选择 1 位成员');

    const now = Date.now();
    const info = db
      .prepare('INSERT INTO conversations (type, name, owner_id, created_at, last_message_at) VALUES (?, ?, ?, ?, ?)')
      .run('group', name, user.id, now, now);
    const cid = Number(info.lastInsertRowid);
    const add = db.prepare('INSERT INTO conversation_members (conversation_id, user_id, joined_at) VALUES (?, ?, ?)');
    add.run(cid, user.id, now);
    for (const id of members) add.run(cid, id, now);

    db.prepare('INSERT INTO messages (conversation_id, sender_id, type, content, created_at) VALUES (?, ?, ?, ?, ?)').run(
      cid, user.id, 'system', `${user.nickname} 创建了群聊`, now
    );
    const view = conversationView(db, cid, user.id);
    sendToUsers([user.id, ...members], { type: 'conversation:new', conversation: view });
    return sendJson(res, 201, { conversation: view });
  }

  throw new HttpError(400, '未知的会话类型');
}

function getConversation({ db, res, user, params }) {
  const cid = Number(params.id);
  if (!isMember(db, cid, user.id)) throw new HttpError(403, '无权访问该会话');
  const view = conversationView(db, cid, user.id);
  if (!view) throw new HttpError(404, '会话不存在');
  sendJson(res, 200, { conversation: view });
}

function getMessages({ db, res, user, params, url }) {
  const cid = Number(params.id);
  if (!isMember(db, cid, user.id)) throw new HttpError(403, '无权访问该会话');
  const before = Number(url.searchParams.get('before') || 0);
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') || 40), 1), 100);

  const rows = db
    .prepare(
      `SELECT m.id, m.conversation_id, m.sender_id, m.type, m.content, m.created_at,
              u.nickname AS sn, u.avatar_hue AS sh
         FROM messages m JOIN users u ON u.id = m.sender_id
        WHERE m.conversation_id = ? ${before ? 'AND m.id < ?' : ''}
        ORDER BY m.id DESC LIMIT ?`
    )
    .all(...(before ? [cid, before, limit] : [cid, limit]));

  sendJson(res, 200, {
    messages: rows.map(mapMessage).reverse(),
    hasMore: rows.length === limit,
  });
}

function postMessage({ db, res, user, params, body, broadcast }) {
  const cid = Number(params.id);
  if (!isMember(db, cid, user.id)) throw new HttpError(403, '无权访问该会话');

  const type = body.type === 'image' ? 'image' : 'text';
  const content = String(body.content || '');
  if (!content) throw new HttpError(400, '消息内容不能为空');
  if (type === 'text' && content.length > 4000) throw new HttpError(400, '消息过长');
  if (type === 'image' && !content.startsWith('/uploads/')) throw new HttpError(400, '图片地址无效');

  const now = Date.now();
  const info = db
    .prepare('INSERT INTO messages (conversation_id, sender_id, type, content, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(cid, user.id, type, content, now);
  db.prepare('UPDATE conversations SET last_message_at = ? WHERE id = ?').run(now, cid);
  db.prepare('UPDATE conversation_members SET last_read_id = ? WHERE conversation_id = ? AND user_id = ?').run(
    Number(info.lastInsertRowid), cid, user.id
  );

  const msg = db
    .prepare(
      `SELECT m.id, m.conversation_id, m.sender_id, m.type, m.content, m.created_at,
              u.nickname AS sn, u.avatar_hue AS sh
         FROM messages m JOIN users u ON u.id = m.sender_id WHERE m.id = ?`
    )
    .get(Number(info.lastInsertRowid));

  const payload = mapMessage(msg);
  broadcast(cid, { type: 'message', message: payload, conversationId: cid }, user.id);
  sendJson(res, 201, { message: payload });
}

function markRead({ db, res, user, params, sendToUser }) {
  const cid = Number(params.id);
  if (!isMember(db, cid, user.id)) throw new HttpError(403, '无权访问该会话');
  const row = db.prepare('SELECT MAX(id) AS m FROM messages WHERE conversation_id = ?').get(cid);
  const lastId = row && row.m ? row.m : 0;
  db.prepare('UPDATE conversation_members SET last_read_id = ? WHERE conversation_id = ? AND user_id = ?').run(lastId, cid, user.id);

  // 通知对方「已读」
  for (const uid of memberIds(db, cid)) {
    if (uid !== user.id) sendToUser(uid, { type: 'read', conversationId: cid, userId: user.id, lastReadId: lastId });
  }
  sendJson(res, 200, { ok: true, lastReadId: lastId });
}

function upload({ res, user, body, uploadDir }) {
  const dataUrl = String(body.dataUrl || '');
  const m = /^data:(image\/(png|jpeg|jpg|webp|gif));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!m) throw new HttpError(400, '仅支持 PNG/JPEG/WebP/GIF 图片');
  const buf = Buffer.from(m[3], 'base64');
  if (buf.length > MAX_UPLOAD) throw new HttpError(413, '图片超过 6MB');

  const ext = m[2] === 'jpeg' ? 'jpg' : m[2];
  mkdirSync(uploadDir, { recursive: true });
  const name = `${user.id}-${randomUUID()}.${ext}`;
  writeFileSync(join(uploadDir, name), buf);
  sendJson(res, 201, { url: `/uploads/${name}` });
}

/* ------------------------------------------------------------------ 路由表 */

const ROUTES = [
  ['POST', /^\/api\/auth\/register$/, register],
  ['POST', /^\/api\/auth\/login$/, login],
  ['POST', /^\/api\/auth\/logout$/, logout],
  ['GET', /^\/api\/me$/, me],
  ['PATCH', /^\/api\/me$/, updateMe],
  ['GET', /^\/api\/users\/search$/, searchUsers],
  ['GET', /^\/api\/contacts$/, contacts],
  ['POST', /^\/api\/contacts$/, addContact],
  ['POST', /^\/api\/contacts\/accept$/, acceptContact],
  ['POST', /^\/api\/contacts\/reject$/, rejectContact],
  ['GET', /^\/api\/conversations$/, listConversations],
  ['POST', /^\/api\/conversations$/, createConversation],
  ['GET', /^\/api\/conversations\/(\d+)$/, getConversation],
  ['GET', /^\/api\/conversations\/(\d+)\/messages$/, getMessages],
  ['POST', /^\/api\/conversations\/(\d+)\/messages$/, postMessage],
  ['POST', /^\/api\/conversations\/(\d+)\/read$/, markRead],
  ['POST', /^\/api\/upload$/, upload],
];

export function createApi({ db, broadcast, sendToUser, sendToUsers, findUserByToken, uploadDir }) {
  return async function handleApi(req, res, url) {
    const path = url.pathname;
    if (!path.startsWith('/api/')) return false;

    let matched = null;
    let params = null;
    let methodMismatch = false;

    for (const [method, pattern, fn] of ROUTES) {
      const m = pattern.exec(path);
      if (!m) continue;
      if (method !== req.method) {
        methodMismatch = true;
        continue;
      }
      matched = fn;
      params = { id: m[1] };
      break;
    }

    if (!matched) {
      sendJson(res, methodMismatch ? 405 : 404, { error: methodMismatch ? '方法不被允许' : '接口不存在' });
      return true;
    }

    try {
      const isPublic = path === '/api/auth/register' || path === '/api/auth/login';
      let user = null;
      if (!isPublic) {
        const header = req.headers.authorization || '';
        const token = header.startsWith('Bearer ') ? header.slice(7) : '';
        req.token = token;
        user = token ? findUserByToken(token) : null;
        if (!user) throw new HttpError(401, '登录已失效，请重新登录');
      }

      const body = ['POST', 'PATCH', 'PUT'].includes(req.method) ? await readBody(req) : {};

      await matched({ db, req, res, url, user, body, params, broadcast, sendToUser, sendToUsers, uploadDir });
    } catch (err) {
      if (err instanceof HttpError) return sendJson(res, err.status, { error: err.message });
      console.error('[api]', err);
      sendJson(res, 500, { error: '服务器内部错误' });
    }
    return true;
  };
}
