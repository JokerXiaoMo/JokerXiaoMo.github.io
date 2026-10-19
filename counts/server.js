/* 计数服务 · 独立 Node 版（无第三方依赖）
   ------------------------------------------------------------------
   给「已经有服务器」的人用。比 Worker 版多出来的只有一件事：
   数据落在本地 counts.json，所以记得定期备份。

   跑起来：
     node counts/server.js
     PORT=8710 DATA=/var/lib/taobai/counts.json node counts/server.js

   挂到 https 后面（站点是 https，前端打 http 会被浏览器拦混合内容）：
     nginx:
       location / {
         proxy_pass http://127.0.0.1:8710;
         proxy_set_header X-Real-IP $remote_addr;
       }
     或者用 caddy 一行：  count.example.com { reverse_proxy 127.0.0.1:8710 }

   接口与 Worker 版完全一致，前端不需要区分：
     POST /hit     { k:"a"|"s", id:"art_xxx" }  → { n: 12 }
     GET  /counts                               → { a:{id:n}, s:{id:n} }
   ------------------------------------------------------------------ */

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 8710);
const DATA = process.env.DATA || path.join(__dirname, 'counts.json');
const KEEP_DAYS = 2;

/* 内存里就是全部数据。几十条记录，没必要上数据库。 */
let store = { a: {}, s: {} };
let writing = null;
let dirty = false;

function dayOf(ts) {
  return new Date(ts).toISOString().slice(0, 10);
}

function fingerprint(ip, ua) {
  return crypto.createHash('sha256').update(ip + '|' + ua).digest('hex').slice(0, 12);
}

/* ---------- 落盘 ---------- */

function load() {
  try {
    const raw = fs.readFileSync(DATA, 'utf8');
    const data = JSON.parse(raw);
    store = { a: data.a || {}, s: data.s || {} };
    console.log('[counts] 读到 %s 条记录', Object.keys(store.a).length + Object.keys(store.s).length);
  } catch (err) {
    if (err.code !== 'ENOENT') {
      /* 文件坏了不能当成空：留个副本给人修，然后从空开始，
         至少不能让服务起不来。 */
      try { fs.copyFileSync(DATA, DATA + '.broken-' + Date.now()); } catch (e) { /* 忽略 */ }
      console.error('[counts] 数据文件解析失败，已备份：%s', err.message);
    }
    store = { a: {}, s: {} };
  }
}

function flush() {
  if (writing || !dirty) return;
  dirty = false;
  const tmp = DATA + '.tmp';
  writing = fs.promises
    .writeFile(tmp, JSON.stringify(store), 'utf8')
    .then(() => fs.promises.rename(tmp, DATA))
    .catch((err) => { console.error('[counts] 写盘失败：%s', err.message); })
    .then(() => { writing = null; if (dirty) flush(); });
}

function scheduleSave() {
  dirty = true;
  if (writing) return;
  setTimeout(flush, 400);
}

/* ---------- 业务 ---------- */

function bucket(k, id) {
  if (!store[k][id]) store[k][id] = { n: 0, seen: {} };
  return store[k][id];
}

function hit(k, id, ip, ua) {
  const rec = bucket(k, id);
  const oldest = dayOf(Date.now() - KEEP_DAYS * 86400000);

  for (const key of Object.keys(rec.seen)) {
    if (key.slice(0, 10) < oldest) delete rec.seen[key];
  }

  const who = dayOf(Date.now()) + ':' + fingerprint(ip, ua);
  if (!rec.seen[who]) {
    rec.seen[who] = 1;
    rec.n += 1;
    scheduleSave();
  }
  return rec.n;
}

/* ---------- HTTP ---------- */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400'
};

function send(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, Object.assign({
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  }, CORS));
  res.end(body);
}

/* 反代后面取真实来源。注意取的是最后一跳：$proxy_add_x_forwarded_for 会把
   客户端自带的 X-Forwarded-For 原样保留在前面，取首段等于让客户端自己报。 */
function clientIp(req) {
  const real = req.headers['x-real-ip'];
  if (real) return String(real).trim();
  const chain = req.headers['x-forwarded-for'];
  if (chain) {
    const parts = String(chain).split(',').map((s) => s.trim()).filter(Boolean);
    if (parts.length) return parts[parts.length - 1];
  }
  return (req.socket.remoteAddress || '0.0.0.0').replace(/^::ffff:/, '');
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      /* 这个接口的合法请求只有几十字节，超过就直接断 */
      if (size > 2048) { reject(new Error('too large')); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const KINDS = { a: 'a', s: 's' };

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS);
    res.end();
    return;
  }

  const url = new URL(req.url, 'http://localhost');
  const route = url.pathname.replace(/\/+$/, '') || '/';

  try {
    if (route === '/hit' && req.method === 'POST') {
      let body;
      try { body = JSON.parse(await readBody(req)); } catch (e) { return send(res, 400, { error: 'bad json' }); }

      const k = KINDS[body && body.k];
      const id = body && body.id;
      if (!k || typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,48}$/.test(id)) {
        return send(res, 400, { error: 'bad target' });
      }

      return send(res, 200, { n: hit(k, id, clientIp(req), req.headers['user-agent'] || '') });
    }

    if (route === '/counts' && req.method === 'GET') {
      const pick = (kind) => {
        const out = {};
        for (const id of Object.keys(store[kind])) out[id] = store[kind][id].n;
        return out;
      };
      return send(res, 200, { a: pick('a'), s: pick('s') });
    }

    if (route === '/health') return send(res, 200, { ok: true });

    return send(res, 404, { error: 'not found' });
  } catch (err) {
    console.error('[counts] %s', err.message);
    return send(res, 503, { error: 'unavailable' });
  }
});

load();

/* 退出前把没写完的刷进去 —— 这一步不做，重启会丢掉最后几秒的计数 */
function shutdown(signal) {
  console.log('[counts] %s，正在收尾', signal);
  server.close(() => {
    dirty = true;
    flush();
    setTimeout(() => process.exit(0), 300);
  });
  setTimeout(() => process.exit(0), 3000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

server.listen(PORT, () => {
  console.log('[counts] 监听 %d，数据文件 %s', PORT, DATA);
});
