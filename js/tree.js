/* ============================================================
   桃白簪花 · 首屏「满树桃花 + 十年之约」
   ------------------------------------------------------------
   这棵树不是装饰，是一本账：
     · 树上的每一朵花 = 十年之约里还没走完的一个月
     · 时间过去一个月，树上就少一朵花（走过的不再出现，也不重播动画）
     · 底下倒计时实时走秒；同时极稀疏地有零散花瓣飘落，表示日子在流走
   树形用固定种子生成 —— 每次打开、每个访客看到的都是同一棵树。

   ⚠️ 一个必须记住的坑：
     SVG2 起 transform 也是 CSS 属性，**CSS 里写 transform 会直接覆盖元素自带的
     transform 属性**。所以这里严格分两层：
       外层 <g class="bloom">  不带 transform 属性 —— 留给 CSS 做落花动画
       内层 <g>                用 transform 属性 —— 负责定位、缩放、旋转
     两者各管一层，互不打架。若把定位也写成 CSS transform，整棵树会瞬间塌到原点。
   ============================================================ */
(function () {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';
  var XLINK = 'http://www.w3.org/1999/xlink';

  var VB_W = 600;
  var VB_H = 470;
  var SEED = 20260914;      /* 固定种子：树形与落花顺序永远一致 */
  var DRIFT_EVERY = 4200;   /* 飘落一片的间隔（毫秒）。稀疏才不像「花洒」 */
  var FALL_MS = 3400;

  var dom = {
    svg: null, blooms: null, drift: null, pledge: null,
    title: null, left: null, count: null, note: null
  };
  var cfg = { years: 10, start: '2026-09-14', effect: 'tree', title: '十年之约' };
  var flowers = [];      /* 每朵花的落点与落花顺序 */
  var bloomEls = [];     /* 与 flowers 同序的 DOM 节点 */
  var fallenCount = -1;  /* 上次渲染时已落几朵，用来判断是否需要播动画 */
  var tickTimer = null;
  var driftTimer = null;
  var io = null;

  /* ---------- 小工具 ---------- */

  function el(name, attrs) {
    var n = document.createElementNS(NS, name);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    }
    return n;
  }

  /* mulberry32：小而稳的种子随机数，同一个种子永远给出同一串 */
  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function reduced() {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  /* ---------- 生成树形 ---------- */

  function buildTree() {
    var rnd = rng(SEED);
    var segs = [];
    var sites = [];

    function grow(x, y, ang, len, wid, depth) {
      var x2 = x + Math.cos(ang) * len;
      var y2 = y + Math.sin(ang) * len;
      segs.push({ x1: x, y1: y, x2: x2, y2: y2, w: wid });
      /* 末两级的每个端点都算一处开花点。
         只在最末梢开花，树冠最里圈会空出一大圈，看着像把伞骨而不是一棵树。 */
      if (depth <= 2) sites.push({ x: x2, y: y2 });
      /* 再沿着靠外的枝条中段点缀一些，把冠内填满 */
      if (depth <= 3 && depth >= 1 && rnd() < 0.55) {
        var u = 0.3 + rnd() * 0.6;
        sites.push({ x: x + (x2 - x) * u, y: y + (y2 - y) * u });
      }
      if (depth <= 0) return;
      /* 头两层固定两叉（保证有主干），再往上偶尔三叉，冠幅才蓬得起来 */
      var n = depth >= 6 ? 2 : (rnd() < 0.38 ? 3 : 2);
      for (var i = 0; i < n; i += 1) {
        var off = (i - (n - 1) / 2) * (0.52 + rnd() * 0.2);
        grow(x2, y2, ang + off + (rnd() - 0.5) * 0.3,
          len * (0.74 + rnd() * 0.07), wid * 0.68, depth - 1);
      }
    }

    /* 主干刻意留短：太长就长成「蘑菇」，不像桃树 */
    grow(0, 0, -Math.PI / 2, 62, 20, 7);
    return { segs: segs, sites: sites };
  }

  /* 把任意尺度的树等比塞进 viewBox：底部居中，四周留白。
     这样调树枝参数时不必反复手算坐标。 */
  function fitter(segs, sites) {
    var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    function acc(x, y) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    segs.forEach(function (s) { acc(s.x1, s.y1); acc(s.x2, s.y2); });
    sites.forEach(function (t) { acc(t.x, t.y); });

    var padX = 30, padTop = 34, padBottom = 20;
    var sc = Math.min(
      (VB_W - padX * 2) / Math.max(1, maxX - minX),
      (VB_H - padTop - padBottom) / Math.max(1, maxY - minY)
    );
    var tx = VB_W / 2 - ((minX + maxX) / 2) * sc;
    var ty = (VB_H - padBottom) - maxY * sc;
    return function (x, y) { return { x: x * sc + tx, y: y * sc + ty }; };
  }

  /* ---------- 组装 SVG ---------- */

  function blossomDef() {
    var d = el('defs');
    var g = el('g', { id: 'blossom' });
    for (var i = 0; i < 5; i += 1) {
      g.appendChild(el('ellipse', {
        cx: '0', cy: '-6.6', rx: '3.5', ry: '5.6',
        transform: 'rotate(' + (i * 72) + ')', 'class': 'blossom-petal'
      }));
    }
    g.appendChild(el('circle', { cx: '0', cy: '0', r: '2', 'class': 'blossom-heart' }));
    d.appendChild(g);

    /* 落花用的小花瓣：单瓣，比整朵花轻 */
    var p = el('g', { id: 'petal-fall' });
    p.appendChild(el('ellipse', {
      cx: '0', cy: '0', rx: '3.4', ry: '5.4', transform: 'rotate(18)', 'class': 'blossom-petal'
    }));
    d.appendChild(p);
    return d;
  }

  function buildScene() {
    var svg = dom.svg;
    var tree = buildTree();
    var to = fitter(tree.segs, tree.sites);
    var rnd = rng(SEED + 7);

    /* 树枝：每段画成微弯的二次曲线，比直线自然 */
    var branchG = el('g', { 'class': 'tree-branches' });
    tree.segs.forEach(function (s) {
      var a = to(s.x1, s.y1);
      var b = to(s.x2, s.y2);
      var mx = (a.x + b.x) / 2 + (b.y - a.y) * 0.06;
      var my = (a.y + b.y) / 2 - (b.x - a.x) * 0.06;
      branchG.appendChild(el('path', {
        d: 'M' + a.x.toFixed(1) + ' ' + a.y.toFixed(1) +
           'Q' + mx.toFixed(1) + ' ' + my.toFixed(1) + ' ' + b.x.toFixed(1) + ' ' + b.y.toFixed(1),
        'stroke-width': Math.max(0.9, s.w).toFixed(2)
      }));
    });

    /* 花朵落点：把开花点按 y 排好再等距取，让花均匀铺满整个冠幅 */
    var total = Math.max(12, Math.round(cfg.years) * 12);
    var sorted = tree.sites.slice().sort(function (a, b) {
      return (a.y - b.y) || (a.x - b.x);
    });
    var picked = [];
    for (var i = 0; i < total; i += 1) {
      var src = sorted.length
        ? sorted[Math.min(sorted.length - 1, Math.floor(i * sorted.length / total))]
        : { x: 0, y: 0 };
      var p = to(src.x, src.y);
      picked.push({
        x: p.x + (rnd() - 0.5) * 12,
        y: p.y + (rnd() - 0.5) * 12,
        rot: rnd() * 360,
        sc: 0.82 + rnd() * 0.3
      });
    }

    /* 落花顺序：洗牌。若改成「从上往下依次落」，中途会变成奇怪的发型。 */
    for (var k = picked.length - 1; k > 0; k -= 1) {
      var j = Math.floor(rnd() * (k + 1));
      var tmp = picked[k]; picked[k] = picked[j]; picked[j] = tmp;
    }
    flowers = picked;

    var bloomG = el('g', { 'class': 'tree-blooms' });
    bloomEls = flowers.map(function (f, idx) {
      var outer = el('g', { 'class': 'bloom', 'data-i': String(idx) });
      outer.style.transformOrigin = f.x.toFixed(1) + 'px ' + f.y.toFixed(1) + 'px';
      var at = el('g', {
        transform: 'translate(' + f.x.toFixed(1) + ' ' + f.y.toFixed(1) + ') ' +
                   'rotate(' + f.rot.toFixed(1) + ') scale(' + f.sc.toFixed(2) + ')',
        /* 每朵花深浅略不同，整棵树才不像贴上去的贴图。
           透明度写在这一层（中间层），不写外层 —— 外层 .bloom 的落花动画要用 opacity，
           两处争同一个属性会互相覆盖。 */
        opacity: (0.74 + rnd() * 0.26).toFixed(2)
      });
      at.appendChild(el('use', { href: '#blossom' }));
      outer.appendChild(at);
      bloomG.appendChild(outer);
      return outer;
    });

    var driftG = el('g', { 'class': 'tree-drift' });

    /* 先把「已经过去的花」摘掉，再挂进文档。
       如果等挂上 DOM 之后再补 is-fallen，浏览器会把这次补类当成一次状态变化，
       于是所有落过的花会在首帧集体淡出一次 —— 访客会看到树上忽然掉一整片。 */
    var preGone = Math.min(bloomEls.length, Math.max(0, monthsElapsed(Date.now())));
    for (var q = 0; q < preGone; q += 1) bloomEls[q].classList.add('is-fallen');
    fallenCount = preGone;

    svg.appendChild(blossomDef());
    svg.appendChild(branchG);
    svg.appendChild(bloomG);
    svg.appendChild(driftG);
    dom.blooms = bloomG;
    dom.drift = driftG;
  }

  /* ---------- 十年之约 ---------- */

  function startDate() {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(cfg.start || ''));
    if (!m) return new Date(2026, 8, 14);
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0, 0);
  }

  function endDate() {
    var e = startDate();
    e.setFullYear(e.getFullYear() + Math.max(1, Math.round(cfg.years)));
    return e;
  }

  /* 已走完的整月数（不看时分秒，只按日历算） */
  function monthsElapsed(now) {
    var s = startDate();
    var b = new Date(now);
    var m = (b.getFullYear() - s.getFullYear()) * 12 + (b.getMonth() - s.getMonth());
    if (b.getDate() < s.getDate()) m -= 1;
    return m;
  }

  function two(n) { return (n < 10 ? '0' : '') + n; }

  function renderPledge() {
    var now = Date.now();
    var s = startDate();
    var e = endDate();
    var total = Math.max(1, Math.round(cfg.years)) * 12;
    var gone = Math.min(total, Math.max(0, monthsElapsed(now)));
    var rest = Math.max(0, total - gone);

    /* 年 / 月 用日历算，日以下才用毫秒 —— 混合算法对闰年和月长都稳 */
    var yr = 0;
    var cursor = new Date(now);
    while (true) {
      var probe = new Date(cursor.getTime());
      probe.setFullYear(probe.getFullYear() + 1);
      if (probe.getTime() > e.getTime()) break;
      cursor = probe;
      yr += 1;
      if (yr > 200) break;
    }
    var mo = 0;
    while (true) {
      var probe2 = new Date(cursor.getTime());
      probe2.setMonth(probe2.getMonth() + 1);
      if (probe2.getTime() > e.getTime()) break;
      cursor = probe2;
      mo += 1;
      if (mo > 12) break;
    }
    var msLeft = Math.max(0, e.getTime() - cursor.getTime());
    var dy = Math.floor(msLeft / 86400000);

    /* 距「下一朵花落」还有多久 —— 比笼统的十年倒计时有用：
       它直接解释了树上那些花为什么会一朵朵掉，而且是每秒都在动的。 */
    var next = new Date(s.getTime());
    next.setMonth(next.getMonth() + Math.min(total, gone + 1));
    var ns = Math.floor(Math.max(0, next.getTime() - now) / 1000);
    var nd = Math.floor(ns / 86400); ns -= nd * 86400;
    var nh = Math.floor(ns / 3600); ns -= nh * 3600;
    var nm = Math.floor(ns / 60); ns -= nm * 60;

    if (dom.left) {
      dom.left.textContent = rest > 0
        ? '还剩 ' + yr + ' 年 ' + mo + ' 个月 ' + dy + ' 天'
        : '十年已满';
    }
    if (dom.count) {
      dom.count.textContent = rest > 0
        ? nd + ' 天 ' + two(nh) + ':' + two(nm) + ':' + two(ns)
        : '——';
    }
    if (dom.note) {
      dom.note.textContent = total + ' 朵花 = ' + total + ' 个月，已落 ' + gone +
        ' 朵，树上还挂着 ' + rest + ' 朵。全部落完是 ' +
        e.getFullYear() + ' 年 ' + (e.getMonth() + 1) + ' 月 ' + e.getDate() + ' 日。';
    }

    if (gone !== fallenCount) {
      applyFallen(gone, fallenCount >= 0 && !reduced());
      fallenCount = gone;
    }
  }

  /* 把已经过去的花摘掉。animate=true 时给「刚刚落下」的那几朵播一次掉落动画。 */
  function applyFallen(gone, animate) {
    for (var i = 0; i < bloomEls.length; i += 1) {
      var node = bloomEls[i];
      var isGone = i < gone;
      if (isGone) {
        if (!node.classList.contains('is-fallen') && !node.classList.contains('is-falling')) {
          if (animate) {
            node.classList.add('is-falling');
            (function (n) {
              window.setTimeout(function () {
                n.classList.remove('is-falling');
                n.classList.add('is-fallen');
              }, FALL_MS);
            })(node);
          } else {
            node.classList.add('is-fallen');
          }
        }
      } else {
        node.classList.remove('is-fallen');
        node.classList.remove('is-falling');
      }
    }
  }

  /* ---------- 零散飘落的花瓣 ---------- */

  function spawnDrift() {
    if (!dom.drift || !dom.svg) return;
    if (reduced() || cfg.effect === 'none') return;
    /* 只从「还挂在树上」的花里挑，落过的位置不该再飘出新花瓣 */
    var alive = [];
    for (var i = fallenCount; i < flowers.length; i += 1) {
      if (!bloomEls[i].classList.contains('is-fallen')) alive.push(flowers[i]);
    }
    if (!alive.length) return;

    var f = alive[Math.floor(Math.random() * alive.length)];
    var outer = el('g', { 'class': 'drift' });
    outer.style.transformOrigin = f.x.toFixed(1) + 'px ' + f.y.toFixed(1) + 'px';
    var at = el('g', {
      transform: 'translate(' + f.x.toFixed(1) + ' ' + f.y.toFixed(1) + ') ' +
                 'rotate(' + (Math.random() * 360).toFixed(1) + ') scale(' +
                 (0.5 + Math.random() * 0.22).toFixed(2) + ')'
    });
    at.appendChild(el('use', { href: '#petal-fall' }));
    outer.appendChild(at);
    outer.addEventListener('animationend', function () {
      if (outer.parentNode) outer.parentNode.removeChild(outer);
    });
    dom.drift.appendChild(outer);
  }

  /* ---------- 生命周期 ---------- */

  function startTimers() {
    if (tickTimer) return;
    renderPledge();
    tickTimer = window.setInterval(renderPledge, 1000);
    if (cfg.effect !== 'none' && !reduced()) {
      driftTimer = window.setInterval(spawnDrift, DRIFT_EVERY);
      window.setTimeout(spawnDrift, 1600);
    }
  }

  function stopTimers() {
    window.clearInterval(tickTimer);
    window.clearInterval(driftTimer);
    tickTimer = null;
    driftTimer = null;
  }

  window.TZTree = {
    /* site 就是 /api/site 或 data/site.json 里的那份配置 */
    init: function (site) {
      dom.svg = document.getElementById('peachTree');
      if (!dom.svg) return null;
      var s = site || {};
      cfg.years = Math.max(1, Math.min(100, Math.round(Number(s.pledgeYears) || 10)));
      cfg.start = String(s.pledgeStart || '2026-09-14');
      cfg.effect = String(s.heroEffect || 'tree');
      cfg.title = String(s.pledgeTitle || '十年之约');

      dom.pledge = document.getElementById('treePledge');
      dom.title = document.getElementById('pledgeTitle');
      dom.left = document.getElementById('pledgeLeft');
      dom.count = document.getElementById('pledgeCount');
      dom.note = document.getElementById('pledgeNote');
      if (dom.title) dom.title.textContent = cfg.title;

      buildScene();
      renderPledge();

      /* 首屏看得到才走表 —— 页脚时停掉，别让看不见的动画白烧电 */
      var hero = document.getElementById('hero');
      var target = hero || dom.svg;
      if ('IntersectionObserver' in window) {
        io = new IntersectionObserver(function (entries) {
          entries.forEach(function (entry) {
            if (entry.isIntersecting) startTimers();
            else stopTimers();
          });
        }, { threshold: 0.06 });
        io.observe(target);
      } else {
        startTimers();
      }
      return { start: startTimers, stop: stopTimers };
    }
  };
})();
