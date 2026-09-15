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
      key = await bd.deriveKey(password, b64ToBytes(entry.salt), iterations);
    } catch (err) {
      return { ok: false, error: '解密失败：' + (err.message || '未知错误') };
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
     这个函数留给内部与调试用。 */
  function lock(id) {
    if (id === undefined) state.keys = {};
    else delete state.keys[id];
    emit();
  }

  /* ---------- 取内容 ---------- */

  async function decryptJson(id) {
    const entry = entryOf(id);
    if (!entry || entry.t !== 'json') return null;
    const key = state.keys[id];
    if (!key) throw new Error('locked');
    const bd = await backend();
    const plain = await bd.decrypt(key, b64ToBytes(entry.iv), b64ToBytes(entry.ct));
    return JSON.parse(new TextDecoder().decode(plain));
  }

  /* 图片条目的标题与说明（和原图共用一份密钥） */
  async function decryptMeta(id) {
    const entry = entryOf(id);
    if (!entry || !entry.meta) return null;
    const key = state.keys[id];
    if (!key) throw new Error('locked');
    const bd = await backend();
    const plain = await bd.decrypt(key, b64ToBytes(entry.meta.iv), b64ToBytes(entry.meta.ct));
    return JSON.parse(new TextDecoder().decode(plain));
  }

  const blobCache = new Map();

  async function decryptBlob(id) {
    const entry = entryOf(id);
    if (!entry || entry.t !== 'bin') return null;
    const key = state.keys[id];
    if (!key) throw new Error('locked');
    if (blobCache.has(id)) return blobCache.get(id);

    const res = await fetch(entry.url, { cache: 'no-store' });
    if (!res.ok) throw new Error('密文读取失败（HTTP ' + res.status + '）');
    const bd = await backend();
    const plain = await bd.decrypt(key, b64ToBytes(entry.iv), new Uint8Array(await res.arrayBuffer()));
    const blob = new Blob([plain], { type: entry.mime || 'application/octet-stream' });
    blobCache.set(id, blob);
    return blob;
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
      msg.textContent = '';
      msg.classList.remove('is-error');
      input.value = '';
      el.hidden = false;
      setTimeout(() => input.focus(), 60);
    });
  }

  function closeGate(ok) {
    const el = document.getElementById('vaultGate');
    if (!el || !state.gateOpen) return;
    state.gateOpen = false;
    el.hidden = true;
    const resolve = state.resolveGate;
    state.resolveGate = null;
    state.gateId = null;
    if (resolve) resolve(Boolean(ok));
  }

  function bindGate() {
    const el = document.getElementById('vaultGate');
    if (!el) return;
    const input = el.querySelector('#vgInput');
    const msg = el.querySelector('#vgMsg');
    const submit = el.querySelector('#vgSubmit');

    const attempt = async () => {
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

    submit.addEventListener('click', attempt);
    el.querySelector('#vgForm').addEventListener('submit', (e) => { e.preventDefault(); attempt(); });
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
