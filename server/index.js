import http from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { openDb } from './db.js';
import { createApi } from './api.js';

const ROOT = join(fileURLToPath(new URL('..', import.meta.url)));
const PUBLIC = join(ROOT, 'public');
const DATA = join(ROOT, 'data');
const UPLOADS = join(DATA, 'uploads');
const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '127.0.0.1';

const db = openDb(join(DATA, 'wetalk.db'));

/* ---------------------------------------------------------------- 认证查找 */

const sessionStmt = db.prepare(
  'SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?'
);

function findUserByToken(token) {
  if (!token) return null;
  return sessionStmt.get(token) || null;
}

/* ---------------------------------------------------------------- 实时通道 */

const wss = new WebSocketServer({ noServer: true });
const online = new Map(); // userId -> Set<WebSocket>

function track(userId, ws) {
  if (!online.has(userId)) online.set(userId, new Set());
  online.get(userId).add(ws);
}

function untrack(userId, ws) {
  const set = online.get(userId);
  if (!set) return;
  set.delete(ws);
  if (set.size === 0) online.delete(userId);
}

function sendToUser(userId, payload) {
  const set = online.get(userId);
  if (!set) return;
  const raw = JSON.stringify(payload);
  for (const ws of set) {
    if (ws.readyState === ws.OPEN) ws.send(raw);
  }
}

function sendToUsers(userIds, payload) {
  for (const id of new Set(userIds)) sendToUser(id, payload);
}

function broadcast(conversationId, payload, exceptUserId) {
  const ids = db.prepare('SELECT user_id FROM conversation_members WHERE conversation_id = ?').all(conversationId);
  for (const { user_id } of ids) {
    if (user_id === exceptUserId) continue;
    sendToUser(user_id, payload);
  }
}

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => {
    ws.isAlive = true;
  });

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (msg.type === 'ping') ws.send(JSON.stringify({ type: 'pong' }));
    if (msg.type === 'typing' && ws.userId) {
      broadcast(Number(msg.conversationId), { type: 'typing', conversationId: Number(msg.conversationId), userId: ws.userId }, ws.userId);
    }
  });

  ws.on('close', () => {
    if (!ws.userId) return;
    untrack(ws.userId, ws);
    if (!online.has(ws.userId)) {
      db.prepare('UPDATE users SET last_seen = ? WHERE id = ?').run(Date.now(), ws.userId);
    }
  });

  ws.on('error', () => {});
});

const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    try {
      ws.ping();
    } catch {}
  }
}, 30000);
heartbeat.unref?.();

/* ---------------------------------------------------------------- 静态文件 */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

function safeJoin(base, pathname) {
  const decoded = decodeURIComponent(pathname);
  const p = normalize(join(base, decoded));
  return p === base || p.startsWith(base + sep) ? p : null;
}

function serveFile(res, filePath, { immutable = false } = {}) {
  if (res.headersSent) return false;
  let st;
  try {
    st = statSync(filePath);
  } catch {
    return false;
  }
  if (!st.isFile()) return false;
  const ext = extname(filePath).toLowerCase();
  const headers = {
    'content-type': MIME[ext] || 'application/octet-stream',
    'content-length': st.size,
    'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
  };
  res.writeHead(200, headers);
  res.end(readFileSync(filePath));
  return true;
}

/* ---------------------------------------------------------------- 服务器 */

const api = createApi({
  db,
  broadcast,
  sendToUser,
  sendToUsers,
  findUserByToken,
  uploadDir: UPLOADS,
});

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'authorization, content-type',
      'access-control-allow-methods': 'GET, POST, PATCH, OPTIONS',
    });
    return res.end();
  }

  if (url.pathname.startsWith('/api/')) {
    const handled = await api(req, res, url);
    if (handled) return;
  }

  if (url.pathname.startsWith('/uploads/')) {
    const file = safeJoin(UPLOADS, url.pathname.slice('/uploads'.length));
    if (file && serveFile(res, file, { immutable: true })) return;
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    return res.end('not found');
  }

  const pathname = url.pathname === '/' ? '/index.html' : url.pathname;
  const file = safeJoin(PUBLIC, pathname);
  if (file && existsSync(file) && serveFile(res, file)) return;

  // SPA 兜底
  if (!extname(url.pathname) && serveFile(res, join(PUBLIC, 'index.html'))) return;

  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('not found');
});

// 单个请求出错不应该拖垮整个服务
const handler = server.listeners('request')[0];
server.removeAllListeners('request');
server.on('request', (req, res) => {
  Promise.resolve(handler(req, res)).catch((err) => {
    console.error('[server]', err);
    if (!res.headersSent) {
      res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('internal error');
    } else {
      try { res.end(); } catch {}
    }
  });
});

server.on('upgrade', (req, socket, head) => {
  let url;
  try {
    url = new URL(req.url, 'http://localhost');
  } catch {
    return socket.destroy();
  }
  if (url.pathname !== '/ws') return socket.destroy();

  const user = findUserByToken(url.searchParams.get('token') || '');
  if (!user) {
    socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
    return socket.destroy();
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    ws.userId = user.id;
    track(user.id, ws);
    db.prepare('UPDATE users SET last_seen = ? WHERE id = ?').run(Date.now(), user.id);
    wss.emit('connection', ws, req);
    ws.send(JSON.stringify({ type: 'ready', userId: user.id }));
  });
});

server.listen(PORT, HOST, () => {
  console.log(`WeTalk 已启动：http://${HOST}:${PORT}`);
  console.log(`数据库：${join(DATA, 'wetalk.db')}`);
});
