/* 桃白簪花 · 加密板块（纯前端解密）
 *
 * 一条内容一个口令：产物 data/locked.json 里每条自带 salt、校验块与密文，
 * 输对哪条的口令就只解开哪条，其余照旧锁着（salt 互不相同，密钥也就互不相同）。
 *
 * 几个刻意的取舍：
 *   - PBKDF2 迭代次数写在 locked.json 的 kdf 里，前端照用，不写死
 *   - 每条先解一段固定明文（check）验口令，口令不对时不必去解一张 5 MB 的图
 *   - 图片密文是独立的 .bin，按需 fetch，不塞进 JSON 再 base64（那会多 33% 体积）
 *   - 解锁态只留在内存里，刻意不写 sessionStorage：
 *     刷新页面即全部重新上锁，「上锁」不是个按钮，而是刷新本身
 *   - 非安全上下文（http://域名、http://局域网IP）下 crypto.subtle 根本不存在，
 *     这时按需加载 js/vault-pure.js 走纯 JS 实现，两套后端接口完全一致
 *   - 文件名是 locked.json 而不是 vault.json：后者在本地存的是口令本身，
 *     两者同名迟早会有人搞混，所以刻意分开
 */
(function (global) {
  'use strict';

  const DATA_URL = '/data/locked.json';
  const PURE_URL = '/js/vault-pure.js';
  const CHECK_PLAIN = 'TAOBAI-VAULT-CHECK-V1';

  const state = {
    config: null,
    keys: {},          /* { [id]: Uint8Array(32) } —— 逐条解锁，互不影响 */
    loaded: false,
    loading: null,
    listeners: [],
    gateOpen: false,
    gateId: null
  };

  /* ---------- base64 <-> 字节 ---------- */

  function b64ToBytes(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
    return out;
  }

  /* 说明：这里原本还有一份「解锁态持久化」——把派生出的密钥按 id 存进
     sessionStorage，并用 kdf/salt 指纹做版本校验，好让同一标签页刷新后免重输。
     用户明确要求「刷新页面立马全部上锁、重新输入口令」，于是持久化与指纹一并移除，
     解锁态只在内存里，重新加载页面就没了。 */

  /* ---------- 密文下载：完整性校验 + 断点续传 + 自动重试 ----------
   *
   * 这段是「解密失败」的真正修复点。
   *
   * 现象：国内访客有时能开、有时一直失败，国外访客永远正常。
   * 原因：一张图 5 MB，密文要从 GitHub Pages 整段拉下来；国内链路经常
   *       把响应从中间掐断。数据少一截，AES-GCM 的认证标签必然对不上，
   *       于是抛出「解密失败」——看起来像是口令错了，其实文件根本没下完。
   * 做法：
   *   ① 每次下载都拿「服务器给的 Content-Length」或「导出时记下的密文字节数」
   *      核对长度，短一字节都不算数；
   *   ② 没下完就带 Range 头从断点续传（GitHub Pages 支持 Range）；
   *   ③ 服务器不认 Range（直接回 200 整段）时丢掉已下部分重来，避免拼错；
   *   ④ 最多 4 轮，轮之间退避等待。
   */

  const MAX_FETCH_TRIES = 4;
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const mb = (n) => (n / 1048576).toFixed(n >= 10485760 ? 0 : 1) + ' MB';

  async function downloadCipher(url, expectedSize, onProgress) {
    const expected = Number(expectedSize) || 0;
    let parts = [];
    let gotLen = 0;
    let total = expected;
    let lastError = null;

    const assemble = () => {
      const out = new Uint8Array(gotLen);
      let off = 0;
      for (let i = 0; i < parts.length; i += 1) { out.set(parts[i], off); off += parts[i].length; }
      return out;
    };
    const report = () => { if (onProgress) onProgress(gotLen, total || gotLen); };

    for (let attempt = 0; attempt < MAX_FETCH_TRIES; attempt += 1) {
      if (total && gotLen >= total) return assemble().slice(0, total);
      try {
        const wantRange = gotLen > 0;
        const res = await fetch(url, {
          cache: 'no-store',
          headers: wantRange ? { Range: 'bytes=' + gotLen + '-' } : {}
        });
        if (!res.ok && res.status !== 206) throw new Error('HTTP ' + res.status);

        const isPartial = res.status === 206;
        /* 请求了续传却拿到整段（服务器不认 Range）：已下部分作废，从头拼 */
        if (wantRange && !isPartial) { parts = []; gotLen = 0; }
        /* 续传时核对起点，起点不符也必须重来，否则拼出来的字节是错位的 */
        if (isPartial) {
          const cr = String(res.headers.get('Content-Range') || '');
          const m = /^bytes\s+(\d+)-/.exec(cr);
          if (m && Number(m[1]) !== gotLen) { parts = []; gotLen = 0; }
        }

        const len = Number(res.headers.get('Content-Length') || 0);
        if (!total) total = isPartial ? gotLen + len : len;

        const reader = (res.body && res.body.getReader) ? res.body.getReader() : null;
        if (!reader) {
          const buf = new Uint8Array(await res.arrayBuffer());
          parts.push(buf); gotLen += buf.length; report();
        } else {
          for (;;) {
            const step = await reader.read();
            if (step.done) break;
            if (!step.value || !step.value.length) continue;
            parts.push(step.value);
            gotLen += step.value.length;
            report();
          }
        }

        if (!gotLen) throw new Error('密文为空');
        if (total && gotLen < total) throw new Error('只收到 ' + mb(gotLen) + ' / ' + mb(total));
        return assemble();
      } catch (err) {
        lastError = err;
        /* 已经下到一部分就留着，下一轮从断点继续 */
        if (attempt < MAX_FETCH_TRIES - 1) await sleep(400 * (attempt + 1));
      }
    }

    const detail = '（' + netReason(lastError) + '）';
    throw new Error('密文没能完整下载' + detail + '，请检查网络后重试');
  }

  /* 浏览器的 fetch 失败信息是英文的（network error / Failed to fetch），
     直接拼进中文提示里很怪，翻成人话再给访客看 */
  function netReason(err) {
    const m = String((err && err.message) || '');
    if (!m) return '连接被中断';
    if (/network error|failed to fetch|load failed|net::err|err_/i.test(m)) return '连接被中断';
    if (/timeout|timed out/i.test(m)) return '连接超时';
    if (/只收到/.test(m)) return m;
    return m;
  }

  /* 把后端抛出的错误翻译成人话。
     关键：WebCrypto 的 crypto.subtle.decrypt 失败时抛的是 DOMException，
     它的 message 往往是空的，前端原样透出就成了「解密失败：未知错误」——
     用户完全不知道发生了什么。这里统一换掉。 */
  function asReadable(err, fallback) {
    const msg = (err && err.message) ? String(err.message) : '';
    if (!msg || /^(DOMException|OperationError|error)$/i.test(msg)) return fallback;
    return msg;
  }

  /* ---------- 解密后端：WebCrypto 优先，纯 JS 兜底 ---------- */

  function hasWebCrypto() {
    return Boolean(global.crypto && global.crypto.subtle);
  }

  function webCryptoBackend() {
    return {
      name: 'webcrypto',
      async deriveKey(password, salt, iterations) {
        const base = await crypto.subtle.importKey(
          'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']
        );
        const bits = await crypto.subtle.deriveBits(
          { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, base, 256
        );
        return new Uint8Array(bits);
      },
      async decrypt(keyBytes, iv, data) {
        const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['decrypt']);
        const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
        return new Uint8Array(plain);
      }
    };
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const el = document.createElement('script');
      el.src = src;
      el.async = true;
      el.onload = () => resolve();
      el.onerror = () => reject(new Error('解密模块加载失败（' + src + '）'));
      document.head.appendChild(el);
    });
  }

  async function pureJsBackend() {
    await loadScript(PURE_URL);
    const P = global.TZVaultPure;
    if (!P) throw new Error('解密模块不可用');
    return {
      name: 'pure-js',
      deriveKey: (password, salt, iterations) => P.deriveKey(password, salt, iterations),
      decrypt: (keyBytes, iv, data) => P.decrypt(keyBytes, iv, data)
    };
  }

  let backendPromise = null;
  function backend() {
    if (!backendPromise) {
      backendPromise = hasWebCrypto() ? Promise.resolve(webCryptoBackend()) : pureJsBackend();
    }
    return backendPromise;
  }

  /* ---------- 加载 ---------- */

  function load() {
    if (state.loading) return state.loading;
    /* 站点没有加密内容时，导出脚本不会注入这个标记，
       于是这里连 /data/locked.json 都不去请求（避免控制台出现 404）。 */
    if (global.__TAOBAI_VAULT__ !== true) {
      state.loaded = true;
      state.loading = Promise.resolve(null);
      return state.loading;
    }
    state.loading = fetch(DATA_URL, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
      .then((cfg) => {
        /* 这里刻意不做任何「恢复上一次解锁状态」的动作：
           每次打开/刷新页面都应该从全锁开始 */
        state.config = (cfg && cfg.items && Object.keys(cfg.items).length) ? cfg : null;
        state.loaded = true;
        return state.config;
      });
    return state.loading;
  }

  function hasVault() {
    return Boolean(state.config);
  }

  function tag() {
    return (state.config && state.config.tag) || '加密';
  }

  const entryOf = (id) => (state.config && state.config.items[id]) || null;

  function isLocked(id) {
    return Boolean(entryOf(id));
  }

  function isUnlocked(id) {
    return Boolean(state.keys[id]);
  }

  function unlockedCount() {
    return Object.keys(state.keys).length;
  }

  /* ---------- 解锁（逐条） ---------- */

  async function unlock(id, password) {
    const entry = entryOf(id);
    if (!entry) return { ok: false, error: '这条内容没有加密数据' };

    let bd;
    try {
      bd = await backend();
    } catch (err) {
      return { ok: false, error: '当前浏览器无法解密：' + (err.message || '未知原因') };
    }

    const iterations = Number((state.config.kdf && state.config.kdf.iterations) || 600000);
    let key;
    try {
      /* 口令原样喂进去：不 trim、不做任何字符处理。
         TextEncoder 统一按 UTF-8 编码，所以中文、符号、中英混排
         和导出端 Node 的 Buffer 编码完全一致，派生出的密钥也一致。 */
      key = await bd.deriveKey(password, b64ToBytes(entry.salt), iterations);
    } catch (err) {
      return { ok: false, error: '解密失败：' + asReadable(err, '浏览器不支持所需算法') };
    }

    /* 先拿校验块验一下，口令不对就不必去解一张 5 MB 的图 */
    try {
      const plain = await bd.decrypt(key, b64ToBytes(entry.check.iv), b64ToBytes(entry.check.ct));
      if (new TextDecoder().decode(plain) !== CHECK_PLAIN) return { ok: false, error: '口令不对' };
    } catch (err) {
      return { ok: false, error: '口令不对' };
    }

    state.keys[id] = key;
    emit();
    return { ok: true };
  }

  /* 上锁：传 id 只锁那一条，不传则全部锁上。
     前台已经没有入口了 —— 上锁交给「刷新页面」本身；
     这个函数留给内部与调试用。
     顺手把解出来的明文 Blob 也丢掉：既然说是「上锁」，内存里就别再留着。 */
  function lock(id) {
    if (id === undefined) {
      state.keys = {};
      blobCache.clear();
      blobInflight.clear();
    } else {
      delete state.keys[id];
      blobCache.delete(id);
    }
    emit();
  }

  /* ---------- 取内容 ---------- */

  async function decryptJson(id) {
    const entry = entryOf(id);
    if (!entry || entry.t !== 'json') return null;
    const key = state.keys[id];
    if (!key) throw new Error('这条内容还没解锁');
    const bd = await backend();
    let plain;
    try {
      plain = await bd.decrypt(key, b64ToBytes(entry.iv), b64ToBytes(entry.ct));
    } catch (err) {
      throw new Error('口令不对，或内容已被改动');
    }
    return JSON.parse(new TextDecoder().decode(plain));
  }

  /* 图片条目的标题与说明（和原图共用一份密钥） */
  async function decryptMeta(id) {
    const entry = entryOf(id);
    if (!entry || !entry.meta) return null;
    const key = state.keys[id];
    if (!key) throw new Error('这条内容还没解锁');
    const bd = await backend();
    let plain;
    try {
      plain = await bd.decrypt(key, b64ToBytes(entry.meta.iv), b64ToBytes(entry.meta.ct));
    } catch (err) {
      throw new Error('口令不对，或内容已被改动');
    }
    return JSON.parse(new TextDecoder().decode(plain));
  }

  const blobCache = new Map();
  /* 同一张图可能被两条路径同时要求解开（点卡片开灯箱、以及解锁回调的批量解）。
     共用一个 promise：5 MB 的下载与解密只做一遍。
     —— 实测过重复调用会把下载量翻倍，国内链路上这就是成功与失败的分界。 */
  const blobInflight = new Map();

  async function decryptBlob(id, onProgress) {
    const entry = entryOf(id);
    if (!entry || entry.t !== 'bin') return null;
    const key = state.keys[id];
    if (!key) throw new Error('这张还没解锁');
    if (blobCache.has(id)) return blobCache.get(id);
    if (blobInflight.has(id)) return blobInflight.get(id);

    const task = (async () => {
      const bd = await backend();
      /* 下载阶段：完整性校验 + 断点续传；onProgress 用来在卡片上显示真实进度 */
      const body = await downloadCipher(entry.url, entry.size, onProgress);
      let plain;
      try {
        plain = await bd.decrypt(key, b64ToBytes(entry.iv), body);
      } catch (err) {
        /* 走到这里只有两种可能：口令不对，或数据在传输中被改过。
           长度已校验过，所以基本就是口令不对。 */
        throw new Error('口令不对，或内容已被改动');
      }
      const blob = new Blob([plain], { type: entry.mime || 'application/octet-stream' });
      blobCache.set(id, blob);
      return blob;
    })();

    blobInflight.set(id, task);
    const clear = () => { if (blobInflight.get(id) === task) blobInflight.delete(id); };
    task.then(clear, clear);   /* 失败也要摘掉，否则重试会被当成「已在处理中」 */
    return task;
  }

  /* ---------- 解锁浮层 ---------- */

  async function ensure(id, reason) {
    if (!state.config) return false;
    if (state.keys[id]) return true;
    return openGate(id, reason || '这条内容已加密，请输入口令');
  }

  function openGate(id, reason) {
    return new Promise((resolve) => {
      const el = document.getElementById('vaultGate');
      if (!el) { resolve(false); return; }
      state.gateOpen = true;
      state.gateId = id;
      state.resolveGate = resolve;
      el.querySelector('#vgReason').textContent = reason;
      const input = el.querySelector('#vgInput');
      const msg = el.querySelector('#vgMsg');
      const eye = el.querySelector('#vgEye');
      msg.textContent = '';
      msg.classList.remove('is-error');
      input.value = '';
      input.type = 'password';      /* 每次打开都收回去，别把上一次的口令亮着 */
      if (eye) { eye.textContent = '显示'; eye.setAttribute('aria-pressed', 'false'); }
      el.hidden = false;
      setTimeout(() => input.focus(), 60);
    });
  }

  function closeGate(ok) {
    const el = document.getElementById('vaultGate');
    if (!el || !state.gateOpen) return;
    const backId = state.gateId;
    state.gateOpen = false;
    el.hidden = true;
    const resolve = state.resolveGate;
    state.resolveGate = null;
    state.gateId = null;
    if (resolve) resolve(Boolean(ok));
    focusBack(backId);
  }

  /* 浮层关掉之后把焦点还给「刚才点开它的那个元素」——
     按 id 找而不是留节点引用：解锁成功会重画卡片（main.js 的 updateGalleryCard），
     原节点那时已经不在文档里了，focus() 只会静默失败。
     灯箱开着时不抢焦点：那时背景里那些图块本来就不该被聚焦。 */
  function focusBack(id) {
    if (!id) return;
    const lb = document.getElementById('lightbox');
    if (lb && !lb.hidden) return;
    const sel = '[data-id="' + String(id).replace(/["\\]/g, '') + '"]';
    const back = document.querySelector('#galleryGrid ' + sel) || document.querySelector(sel);
    if (!back || typeof back.focus !== 'function') return;
    try { back.focus({ preventScroll: true }); } catch (err) { back.focus(); }
  }

  function bindGate() {
    const el = document.getElementById('vaultGate');
    if (!el) return;
    const input = el.querySelector('#vgInput');
    const msg = el.querySelector('#vgMsg');
    const submit = el.querySelector('#vgSubmit');
    const eye = el.querySelector('#vgEye');

    const attempt = async () => {
      /* 中文口令靠输入法打，候选词还在屏上的时候按回车是「选词」而不是「提交」。
         中文输入法在组合期间会派发一个 keyCode 229 / isComposing 为真的回车，
         这里直接忽略，否则会把没上屏的字母当成口令提交，表现为「口令怎么都不对」。 */
      if (input.dataset.composing === '1') return;
      const value = input.value;
      const id = state.gateId;
      if (!value) { input.focus(); return; }
      submit.disabled = true;
      msg.classList.remove('is-error');
      msg.textContent = '正在解密…';
      const res = await unlock(id, value);
      submit.disabled = false;
      if (res.ok) {
        input.value = '';
        closeGate(true);
        return;
      }
      msg.classList.add('is-error');
      msg.textContent = res.error;
      input.select();
    };

    /* 口令可以含中文与符号，看不见字符时最容易打成错的，
       所以给个「显示」开关，让访客能自己核对一遍 */
    if (eye) {
      eye.addEventListener('click', () => {
        const show = input.type === 'password';
        input.type = show ? 'text' : 'password';
        eye.textContent = show ? '隐藏' : '显示';
        eye.setAttribute('aria-pressed', show ? 'true' : 'false');
        input.focus();
      });
    }

    input.addEventListener('compositionstart', () => { input.dataset.composing = '1'; });
    input.addEventListener('compositionend', () => {
      delete input.dataset.composing;
      /* 组合结束顺手把 IME 刚上屏的字符留在输入框里，不做任何加工 */
    });

    submit.addEventListener('click', attempt);
    el.querySelector('#vgForm').addEventListener('submit', (e) => {
      e.preventDefault();
      if (e.isComposing) return;
      attempt();
    });
    el.querySelectorAll('[data-vg-close]').forEach((btn) => btn.addEventListener('click', () => closeGate(false)));
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); closeGate(false); }
    });
  }

  /* ---------- 订阅 ---------- */

  function onChange(cb) {
    state.listeners.push(cb);
  }

  function emit() {
    state.listeners.forEach((cb) => {
      try { cb(state.keys); } catch (err) { /* 订阅方自己的错，不影响别人 */ }
    });
  }

  global.TZVault = {
    load, hasVault, tag,
    isLocked, isUnlocked, unlockedCount, hasWebCrypto,
    ensure, unlock, lock,
    decryptJson, decryptMeta, decryptBlob,
    onChange, bindGate, openGate, closeGate
  };
})(window);
