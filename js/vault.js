/* 桃白簪花 · 加密板块（纯前端解密）
 *
 * 密文与 KDF 参数来自产物里的 data/locked.json；口令只在浏览器里用一次，
 * 派生完密钥就丢掉口令，解锁态以「原始密钥字节」存 sessionStorage（关标签页即失效）。
 *
 * 几个刻意的取舍：
 *   - PBKDF2 迭代 60 万次由服务端在导出时写进 locked.json，前端照用，不写死
 *   - 先拿一段固定明文（check）验口令，口令不对时不必去解一张 5 MB 的图
 *   - 图片密文是独立的 .bin，按需 fetch，不塞进 JSON 再 base64（那会多 33% 体积）
 *   - 迭代参数或 salt 变了（重新导出）就自动作废旧解锁态
 *   - 文件名是 locked.json 而不是 vault.json：后者在本地存的是口令本身，
 *     两者同名迟早会有人搞混，所以刻意分开
 */
(function (global) {
  'use strict';

  const DATA_URL = '/data/locked.json';
  const STORAGE_KEY = 'tz-vault-key';
  const CHECK_PLAIN = 'TAOBAI-VAULT-CHECK-V1';

  const state = {
    config: null,
    key: null,
    loaded: false,
    loading: null,
    listeners: [],
    gateOpen: false
  };

  /* ---------- base64 <-> 字节 ---------- */

  function b64ToBytes(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
    return out;
  }

  function bytesToB64(buf) {
    const bytes = new Uint8Array(buf);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 8192) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
    }
    return btoa(bin);
  }

  const fingerprint = (cfg) =>
    [cfg.kdf.name, cfg.kdf.hash, cfg.kdf.iterations, cfg.kdf.salt].join('|');

  /* ---------- 加载与派生 ---------- */

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
        state.config = (cfg && cfg.items && Object.keys(cfg.items).length) ? cfg : null;
        state.loaded = true;
        if (state.config) restore();
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

  function isUnlocked() {
    return Boolean(state.key);
  }

  function isLocked(id) {
    if (!state.config) return false;
    const file = state.config.items[id + ':file'];
    return Boolean(state.config.items[id] || file);
  }

  async function deriveKey(password) {
    const cfg = state.config;
    const base = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']
    );
    return crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: b64ToBytes(cfg.kdf.salt),
        iterations: Number(cfg.kdf.iterations) || 600000,
        hash: cfg.kdf.hash || 'SHA-256'
      },
      base,
      { name: 'AES-GCM', length: 256 },
      true,
      ['decrypt']
    );
  }

  async function decryptWith(key, ivB64, dataBuf) {
    return crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: b64ToBytes(ivB64) }, key, dataBuf
    );
  }

  async function verifyKey(key) {
    try {
      const plain = await decryptWith(key, state.config.check.iv, b64ToBytes(state.config.check.ct));
      return new TextDecoder().decode(plain) === CHECK_PLAIN;
    } catch (err) {
      return false;
    }
  }

  function persist(key) {
    try {
      crypto.subtle.exportKey('raw', key).then((raw) => {
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
          fp: fingerprint(state.config), k: bytesToB64(raw)
        }));
      });
    } catch (err) { /* 存不了就算了，只是刷新后要重输 */ }
  }

  function restore() {
    try {
      const saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || 'null');
      if (!saved || saved.fp !== fingerprint(state.config)) return;
      const raw = b64ToBytes(saved.k);
      crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, true, ['decrypt'])
        .then((key) => {
          /* 换了密码或重新导出后，旧密钥要能自己失效 */
          return verifyKey(key).then((ok) => { if (ok) state.key = key; else state.key = null; });
        })
        .then(emit)
        .catch(() => {});
    } catch (err) { /* 忽略 */ }
  }

  /* ---------- 对外：解锁 ---------- */

  async function unlock(password) {
    if (!state.config) return { ok: false, error: '这个站点没有加密内容' };
    if (!global.crypto || !crypto.subtle) {
      return { ok: false, error: '当前环境不支持解密（需要 https 或 localhost）' };
    }
    let key;
    try {
      key = await deriveKey(password);
    } catch (err) {
      return { ok: false, error: '解密失败：' + (err.message || '未知错误') };
    }
    if (!await verifyKey(key)) return { ok: false, error: '口令不对' };
    state.key = key;
    persist(key);
    emit();
    return { ok: true };
  }

  function lock() {
    state.key = null;
    try { sessionStorage.removeItem(STORAGE_KEY); } catch (err) { /* 忽略 */ }
    emit();
  }

  /* ---------- 取内容 ---------- */

  async function decryptJson(id) {
    const entry = state.config && state.config.items[id];
    if (!entry || entry.t !== 'json') return null;
    if (!state.key) throw new Error('locked');
    const plain = await decryptWith(state.key, entry.iv, b64ToBytes(entry.ct));
    return JSON.parse(new TextDecoder().decode(plain));
  }

  const blobCache = new Map();

  async function decryptBlob(id) {
    const entry = state.config && state.config.items[id + ':file'];
    if (!entry || entry.t !== 'bin') return null;
    if (!state.key) throw new Error('locked');
    if (blobCache.has(id + ':file')) return blobCache.get(id + ':file');
    const res = await fetch(entry.url, { cache: 'no-store' });
    if (!res.ok) throw new Error('密文读取失败（HTTP ' + res.status + '）');
    const plain = await decryptWith(state.key, entry.iv, await res.arrayBuffer());
    const blob = new Blob([plain], { type: entry.mime || 'application/octet-stream' });
    blobCache.set(id + ':file', blob);
    return blob;
  }

  /* ---------- 解锁浮层 ---------- */

  async function ensure(reason) {
    if (!state.config) return false;
    if (state.key) return true;
    return openGate(reason || '这部分内容已加密，请输入口令');
  }

  function openGate(reason) {
    return new Promise((resolve) => {
      const el = document.getElementById('vaultGate');
      if (!el) { resolve(false); return; }
      state.gateOpen = true;
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
      if (!value) { input.focus(); return; }
      submit.disabled = true;
      msg.classList.remove('is-error');
      msg.textContent = '正在解密…';
      const res = await unlock(value);
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
      try { cb(state.key); } catch (err) { /* 订阅方自己的错，不影响别人 */ }
    });
  }

  global.TZVault = {
    load, hasVault, isLocked, isUnlocked, tag, ensure, unlock, lock,
    decryptJson, decryptBlob, onChange, bindGate, openGate, closeGate
  };
})(window);
