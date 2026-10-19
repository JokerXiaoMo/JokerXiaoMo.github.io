/* 计数服务 · Cloudflare Worker 版
   ------------------------------------------------------------------
   为什么单独做一个：站点托管在 GitHub Pages，纯静态，没有地方写文件。
   「阅读」「已被打开」这类计数只需要两个很笨的接口，没必要为此把整个
   后台搬到公网。

   部署（五分钟，不需要自己的域名，Worker 自带 *.workers.dev 的 https）：
     1. 打开 dash.cloudflare.com → Workers & Pages → 创建 Worker
     2. 把本文件的代码整个贴进去，替换默认内容
     3. 在 Settings → Variables → KV Namespace Bindings 新建绑定：
          变量名填 COUNTS（大小写要一致），选一个新创建的 namespace
     4. 部署，拿到 https://xxx.workers.dev
     5. 把地址填进站点的 /data/stats.json 的 endpoint

   接口：
     POST /hit     { k:"a"|"s", id:"art_xxx" }  → { n: 12 }
     GET  /counts                               → { a:{id:n}, s:{id:n} }

   两条规矩：
     - 同一个 IP + UA 同一天同一条只 +1，刷新页面不会涨数
     - 只回数字，不回任何别的信息
   ------------------------------------------------------------------ */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400'
};

/* 去重记录留两天就够：跨过零点后同一个人还能再算一次，这是常规口径 */
const KEEP_DAYS = 2;

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, CORS)
  });
}

function dayOf(ts) {
  return new Date(ts).toISOString().slice(0, 10);
}

function dayBefore(n) {
  return dayOf(Date.now() - n * 86400000);
}

/* 短哈希：只用来认「是不是同一个人」，不保存 IP 本身 */
async function fingerprint(ip, ua) {
  const raw = new TextEncoder().encode(ip + '|' + ua);
  const buf = await crypto.subtle.digest('SHA-256', raw);
  return Array.from(new Uint8Array(buf).slice(0, 6))
    .map((b) => b.toString(16).padStart(2, '0')).join('');
}

function validId(id) {
  return typeof id === 'string' && /^[A-Za-z0-9_-]{1,48}$/.test(id);
}

function validKind(k) {
  return k === 'a' || k === 's';
}

async function readState(env, k, id) {
  const st = await env.COUNTS.get('c:' + k + ':' + id, 'json');
  if (!st || typeof st.n !== 'number') return { n: 0, seen: {} };
  return { n: st.n, seen: st.seen || {} };
}

async function hit(env, k, id, request) {
  const st = await readState(env, k, id);
  const oldest = dayBefore(KEEP_DAYS);

  /* 顺手清掉过期的去重记录，免得对象越滚越大 */
  for (const key of Object.keys(st.seen)) {
    if (key.slice(0, 10) < oldest) delete st.seen[key];
  }

  const ip = request.headers.get('CF-Connecting-IP') || '0.0.0.0';
  const who = dayOf(Date.now()) + ':' + await fingerprint(ip, request.headers.get('User-Agent') || '');

  let changed = false;
  if (!st.seen[who]) {
    st.seen[who] = 1;
    st.n += 1;
    changed = true;
  }
  if (changed) {
    await env.COUNTS.put('c:' + k + ':' + id, JSON.stringify(st), {
      /* 无人访问后自动过期，不必手动维护 */
      expirationTtl: 60 * 60 * 24 * 400
    });
  }
  return st.n;
}

async function dump(env, k) {
  const prefix = 'c:' + k + ':';
  const out = {};
  let cursor = null;

  do {
    const page = await env.COUNTS.list({ prefix, cursor });
    for (const key of page.keys) {
      const st = await env.COUNTS.get(key.name, 'json');
      if (st && typeof st.n === 'number') out[key.name.slice(prefix.length)] = st.n;
    }
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);

  return out;
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    try {
      if (path === '/hit' && request.method === 'POST') {
        let body;
        try { body = await request.json(); } catch (e) { return json({ error: 'bad json' }, 400); }

        const k = body && body.k;
        const id = body && body.id;
        if (!validKind(k) || !validId(id)) return json({ error: 'bad target' }, 400);

        return json({ n: await hit(env, k, id, request) });
      }

      if (path === '/counts' && request.method === 'GET') {
        return json({ a: await dump(env, 'a'), s: await dump(env, 's') });
      }

      return json({ error: 'not found' }, 404);
    } catch (err) {
      /* 计数挂掉不该影响站点：前端拿不到数就保持原样 */
      return json({ error: 'unavailable' }, 503);
    }
  }
};
