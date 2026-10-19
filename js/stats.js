/* 计数客户端
   ------------------------------------------------------------------
   纯静态托管没法写文件，所以「阅读」「已被打开」这两个数只能由一个
   独立的小服务记。这里只做三件事：读配置、报一次、把数写回页面。

   约定：
     POST  {endpoint}/hit     {k:"a"|"s", id:"art_xxx"}  → {n: 12}
     GET   {endpoint}/counts                            → {a:{id:n}, s:{id:n}}

   三条硬规矩（踩过的坑，别改）：
     1. 失败就当没发生。不重试、不转圈、不写 0。
     2. 回填只改 textContent，绝不整块重渲染 —— 否则所有卡片会重新淡入。
     3. 同一页面生命周期内，同一条只报一次，避免来回切阅读页刷数。
   ------------------------------------------------------------------ */
(function () {
  'use strict';

  var CONFIG_PATH = '/data/stats.json';
  var TIMEOUT = 6000;

  var conf = { endpoint: '', enabled: false };
  var counts = { a: {}, s: {} };
  var reported = {};      /* 已报过的 key，防同一页重复报 */
  var refreshing = null;

  /* 文案：文章看「次阅读」，工具看「已被打开 N 次」 */
  function label(k, n) {
    return k === 's' ? '已被打开 ' + n + ' 次' : n + ' 次阅读';
  }

  function trimSlash(u) {
    return String(u || '').replace(/\/+$/, '');
  }

  function timeout(ms) {
    return new Promise(function (_, reject) {
      setTimeout(function () { reject(new Error('timeout')); }, ms);
    });
  }

  function request(path, options) {
    return Promise.race([
      fetch(conf.endpoint + path, options),
      timeout(TIMEOUT)
    ]);
  }

  /* ---------- 配置 ---------- */

  function loadConfig() {
    return fetch(CONFIG_PATH, { headers: { Accept: 'application/json' }, cache: 'no-store' })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (cfg) {
        conf.endpoint = trimSlash(cfg && cfg.endpoint);
        conf.enabled = /^https?:\/\//.test(conf.endpoint);
        return conf.enabled;
      })
      .catch(function () { conf.enabled = false; return false; });
  }

  /* ---------- 回填 ---------- */

  /* root 里所有带 data-count="a:art_xxx" 的节点，用已知的数覆盖文字。
     服务端还没回数的，保持渲染时的原样（本地 JSON 里的旧值）。 */
  function paint(root) {
    if (!conf.enabled) return;
    var scope = root || document;
    var nodes = scope.querySelectorAll('[data-count]');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var key = el.getAttribute('data-count') || '';
      var at = key.indexOf(':');
      if (at < 1) continue;
      var k = key.slice(0, at);
      var id = key.slice(at + 1);
      var bag = counts[k];
      if (!bag) continue;
      var n = bag[id];
      if (n === undefined || n === null) continue;
      var text = label(k, n);
      if (el.textContent !== text) el.textContent = text;
      /* 渲染时 0 次是藏着的，第一次有人读过才让它露出来 */
      if (n > 0 && el.classList.contains('is-count-hidden')) {
        el.classList.remove('is-count-hidden');
      }
    }
  }

  /* ---------- 上报 ---------- */

  function track(k, id) {
    if (!conf.enabled || !id) return;
    var key = k + ':' + id;
    if (reported[key]) return;
    reported[key] = true;

    request('/hit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ k: k, id: id }),
      keepalive: true
    })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (data) {
        if (!data || typeof data.n !== 'number') return;
        counts[k] = counts[k] || {};
        counts[k][id] = data.n;
        paint();
      })
      .catch(function () { /* 服务不在就不在，页面不负责提醒 */ });
  }

  /* ---------- 拉取 ---------- */

  function merge(k, incoming) {
    if (!incoming) return;
    counts[k] = counts[k] || {};
    for (var id in incoming) {
      if (!Object.prototype.hasOwnProperty.call(incoming, id)) continue;
      var n = Number(incoming[id]);
      if (!isFinite(n)) continue;
      /* 取大值：刚上报拿到的数可能比这次拉取更新 */
      var old = counts[k][id];
      counts[k][id] = (typeof old === 'number' && old > n) ? old : n;
    }
  }

  function refresh() {
    if (refreshing) return refreshing;

    /* 等配置到位再判断走不走 —— 否则调用时机早于配置加载就会静默空转 */
    refreshing = ready
      .then(function () {
        if (!conf.enabled) return false;
        return request('/counts', { headers: { Accept: 'application/json' }, cache: 'no-store' })
          .then(function (res) { return res.ok ? res.json() : null; })
          .then(function (data) {
            if (!data) return false;
            merge('a', data.a);
            merge('s', data.s);
            paint();
            return true;
          });
      })
      .catch(function () { return false; })
      .then(function (ok) { refreshing = null; return ok; });

    return refreshing;
  }

  var ready = loadConfig();

  window.TZStats = {
    /* boot 里 await 这个，就知道该不该渲染计数 */
    ready: ready,
    get enabled() { return conf.enabled; },
    get endpoint() { return conf.endpoint; },
    /* 渲染时取当前已知值；服务端还没回数就当 0（静态 JSON 里的数已归零） */
    get: function (k, id) {
      var bag = counts[k];
      var n = bag ? bag[id] : undefined;
      return typeof n === 'number' ? n : 0;
    },
    /* 渲染文案与回填共用一套说法，免得两处对不上 */
    text: label,
    track: track,
    refresh: refresh,
    paint: paint
  };
})();
