/* TAOBAI-STATIC-BUILD */
/* 静态部署构建产物（由 tools/export-static.js 生成）：
   数据直接读 /data/*.json，不请求 /api/*（静态托管没有后端）。 */
window.__TAOBAI_STATIC__ = true;
/* 本站有加密内容：前端据此才去取 /data/locked.json。
   没有加密内容时不注入这个标记，前端连请求都不发，省得控制台出现 404。 */
window.__TAOBAI_VAULT__ = true;
/* 桃白簪花自然科技工作室 · 主站交互 */
(function () {
  'use strict';

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.prototype.slice.call((root || document).querySelectorAll(sel));

  const state = {
    site: null,
    articles: [],
    shares: [],
    gallery: [],
    view: { articles: [], shares: [], gallery: [] },
    articleTag: 'all',
    galleryTag: 'all',
    shareCat: 'all',
    keyword: '',
    lbList: [],
    lbIndex: 0,
    sdId: '',
    /* 加密：解锁后的图片 Blob URL（按 id 缓存），上锁或重新锁定时会 revoke 掉 */
    decUrls: {},
    /* 静态部署模式：没有后端，数据读 /data/*.json，写操作自动跳过。
       静态导出时（tools/export-static.js）会在产物里预置 window.__TAOBAI_STATIC__ = true，
       于是这里一开始就为 true，不会再去探测 /api/*（避免控制台出现一堆 404）。
       不带标记时（本地 Node 服务）保持 false，走正常接口。 */
    staticMode: window.__TAOBAI_STATIC__ === true
  };

  /* ---------------- 工具 ---------------- */

  function esc(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function formatDate(value) {
    if (!value) return '';
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value));
    if (!m) return String(value);
    return m[1] + '年' + Number(m[2]) + '月' + Number(m[3]) + '日';
  }

  function hexToRgba(hex, alpha) {
    const value = String(hex || '#C75B7A').replace('#', '');
    const full = value.length === 3 ? value.split('').map((c) => c + c).join('') : value;
    const num = parseInt(full, 16);
    if (Number.isNaN(num)) return 'rgba(199,91,122,' + alpha + ')';
    return 'rgba(' + ((num >> 16) & 255) + ',' + ((num >> 8) & 255) + ',' + (num & 255) + ',' + alpha + ')';
  }

  /* 推荐理由一类的多行文本：没写 Markdown 就按纯文本排（保留换行），
     写了 Markdown（标题/列表/加粗/链接/表格）就跟正文一样渲染。 */
  function richText(text) {
    const src = String(text == null ? '' : text).replace(/\r\n/g, '\n').trim();
    if (!src) return '';
    const looksMarkdown = /(^|\n)\s{0,3}(#{1,4}\s|[-*+]\s|\d+[.)]\s|>\s|```|\|)/.test(src) ||
      /\*\*[^*\n]+\*\*/.test(src) || /\[[^\]\n]+\]\([^)\s]+\)/.test(src);
    if (looksMarkdown) return window.TZMarkdown.render(src);
    return src.split(/\n{2,}/).map((block) =>
      '<p>' + esc(block).split('\n').map((line) => line.trim()).filter(Boolean).join('<br>') + '</p>'
    ).join('');
  }

  let toastTimer = null;

  function toast(message) {
    const el = $('#toast');
    el.textContent = message;
    el.classList.add('is-show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('is-show'), 2600);
  }

  async function api(path, options) {
    const res = await fetch(path, options);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || '请求失败');
    return data;
  }

  /* 双模式取数：优先走后端接口；后端不存在（纯静态托管）时回退读 /data/*.json。
     静态托管的 404 页面常常返回 200 + HTML，所以这里不仅看状态码，还要看能否解析出结构。 */
  async function loadData(apiPath, staticPath, isExpected) {
    /* 已知是静态部署：跳过接口探测，直接读静态 JSON（少 4 个无谓的 404） */
    if (!state.staticMode) {
      try {
        const res = await fetch(apiPath, { headers: { Accept: 'application/json' } });
        if (res.ok) {
          const data = await res.json();
          if (data && isExpected(data)) return data;
        }
      } catch (err) { /* 落回静态模式 */ }
    }
    const res = await fetch(staticPath, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error('数据加载失败');
    const data = await res.json();
    state.staticMode = true;
    return data;
  }

  /* 计数类写操作：静态模式下没有后端，直接跳过（不报错、不打扰用户） */
  function track(path, options) {
    if (state.staticMode) return;
    api(path, options).catch(() => {});
  }

  /* ---------------- 站点配置 ---------------- */

  function applySite(site) {
    state.site = site;
    document.title = site.name + ' · ' + site.slogan;
    document.documentElement.style.setProperty('--accent', site.accent || '#C75B7A');

    const brand = $('#brandText');
    if (brand) brand.textContent = site.shortName || site.name;
    const slogan = $('#heroSlogan');
    if (slogan) slogan.textContent = site.slogan || '';
    const intro = $('#heroIntro');
    if (intro) intro.textContent = site.intro || '';
    const footer = $('#footerText');
    if (footer) footer.textContent = site.footer || site.name;

    const nav = $('#navLinks');
    if (nav) {
      nav.innerHTML = (site.nav || []).map((item) =>
        '<a href="#' + esc(item.id) + '" data-target="' + esc(item.id) + '">' + esc(item.label) + '</a>'
      ).join('');
    }

    const drawerLinks = $('#navDrawerLinks');
    if (drawerLinks) {
      drawerLinks.innerHTML = (site.nav || []).map((item) =>
        '<a href="#' + esc(item.id) + '">' + esc(item.label) +
        '<em>' + esc(item.en || '') + '</em></a>'
      ).join('');
    }
    const drawerFoot = $('#navDrawerFoot');
    if (drawerFoot) {
      drawerFoot.innerHTML = (site.social || []).map((item) =>
        '<a href="' + esc(item.url) + '" target="_blank" rel="noopener">' + esc(item.label) + '</a>'
      ).join('');
    }

    const social = $('#footerSocial');
    if (social) {
      social.innerHTML = (site.social || []).map((item) =>
        '<a href="' + esc(item.url) + '" target="_blank" rel="noopener">' + esc(item.label) + '</a>'
      ).join('');
    }

    const about = $('#aboutBody');
    if (about) {
      about.innerHTML = String(site.about || '').split(/\n{2,}/)
        .filter(Boolean).map((p) => '<p>' + esc(p).replace(/\n/g, '<br>') + '</p>').join('');
    }
    const meta = $('#aboutMeta');
    if (meta) {
      const items = [];
      if (site.location) items.push('<div>所在<strong>' + esc(site.location) + '</strong></div>');
      if (site.email) items.push('<div>联络<strong>' + esc(site.email) + '</strong></div>');
      items.push('<div>成立<strong>2026</strong></div>');
      meta.innerHTML = items.join('');
    }
  }

  /* ---------------- 主题 ---------------- */

  function initTheme() {
    const saved = localStorage.getItem('tz-theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const theme = saved || (prefersDark ? 'dark' : 'light');
    document.documentElement.setAttribute('data-theme', theme);
    $('#themeToggle').addEventListener('click', () => {
      const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      localStorage.setItem('tz-theme', next);
      Petals.recolor();
    });
  }

  /* ---------------- 导航 ---------------- */

  function initNav() {
    const nav = $('#siteNav');
    const progress = $('#scrollProgress');
    const links = () => $$('.nav-links a');

    function onScroll() {
      const y = window.scrollY;
      nav.classList.toggle('is-scrolled', y > 40);
      const height = document.documentElement.scrollHeight - window.innerHeight;
      progress.style.width = (height > 0 ? (y / height) * 100 : 0) + '%';

      let current = '';
      $$('main section[id]').forEach((section) => {
        if (section.getBoundingClientRect().top <= 140) current = section.id;
      });
      links().forEach((a) => a.classList.toggle('is-active', a.dataset.target === current));
    }

    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();

    /* 移动端导航抽屉 */
    const drawer = $('#navDrawer');
    const menuBtn = $('#menuToggle');
    function closeDrawer() {
      if (!drawer || !drawer.classList.contains('is-open')) return;
      drawer.classList.remove('is-open');
      menuBtn.classList.remove('is-open');
      menuBtn.setAttribute('aria-expanded', 'false');
    }
    if (drawer && menuBtn) {
      menuBtn.addEventListener('click', () => {
        const open = !drawer.classList.contains('is-open');
        drawer.classList.toggle('is-open', open);
        menuBtn.classList.toggle('is-open', open);
        menuBtn.setAttribute('aria-expanded', String(open));
      });
      drawer.addEventListener('click', (e) => {
        if (e.target.closest('a')) closeDrawer();
      });
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeDrawer();
      });
      window.addEventListener('scroll', () => {
        if (window.scrollY > 80) closeDrawer();
      }, { passive: true });
      window.addEventListener('resize', () => {
        if (window.innerWidth > 900) closeDrawer();
      });
    }

    const bar = $('#searchBar');
    const input = $('#searchInput');
    $('#searchToggle').addEventListener('click', () => {
      bar.classList.toggle('is-open');
      if (bar.classList.contains('is-open')) input.focus();
    });

    let debounce = null;
    input.addEventListener('input', () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        state.keyword = input.value.trim().toLowerCase();
        renderAll();
      }, 180);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        input.value = '';
        state.keyword = '';
        bar.classList.remove('is-open');
        renderAll();
      }
    });
  }

  /* ---------------- 滚动进场 ---------------- */

  function initReveal() {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-in');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
    $$('.reveal').forEach((el) => observer.observe(el));
  }

  function observeReveal(scope) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry, index) => {
        if (entry.isIntersecting) {
          entry.target.style.setProperty('--d', (index % 8) * 60 + 'ms');
          entry.target.classList.add('is-in');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.08, rootMargin: '0px 0px -30px 0px' });
    $$('.reveal-item:not(.is-in)', scope || document).forEach((el) => observer.observe(el));
  }

  /* ---------------- 花瓣飘落 ---------------- */

  const Petals = (function () {
    let canvas, ctx, items = [], running = false, raf = null, color = '#C75B7A';
    let width = 0, height = 0;

    function resize() {
      if (!canvas) return;
      /* 触屏机与低核心数设备降低像素比和花瓣数量，避免掉帧 */
      const lowEnd = window.matchMedia('(pointer: coarse)').matches
        || (navigator.hardwareConcurrency || 4) <= 4;
      const dpr = Math.min(window.devicePixelRatio || 1, lowEnd ? 1.5 : 2);
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const target = lowEnd
        ? Math.max(8, Math.min(16, Math.round(width / 74)))
        : Math.max(14, Math.min(34, Math.round(width / 46)));
      while (items.length < target) items.push(spawn(true));
      items.length = target;
    }

    function spawn(randomY) {
      return {
        x: Math.random() * width,
        y: randomY ? Math.random() * height : -30,
        size: 5 + Math.random() * 7,
        speed: 0.35 + Math.random() * 0.65,
        sway: 0.5 + Math.random() * 1.1,
        phase: Math.random() * Math.PI * 2,
        swaySpeed: 0.004 + Math.random() * 0.008,
        rot: Math.random() * Math.PI,
        rotSpeed: (Math.random() - 0.5) * 0.012,
        alpha: 0.28 + Math.random() * 0.4
      };
    }

    function draw() {
      if (!ctx) return;
      ctx.clearRect(0, 0, width, height);
      items.forEach((p) => {
        p.y += p.speed;
        p.phase += p.swaySpeed;
        p.rot += p.rotSpeed;
        p.x += Math.sin(p.phase) * p.sway * 0.5;
        if (p.y > height + 30) {
          Object.assign(p, spawn(false));
          p.x = Math.random() * width;
        }
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.beginPath();
        ctx.ellipse(0, 0, p.size, p.size * 0.58, 0, 0, Math.PI * 2);
        ctx.fillStyle = hexToRgba(color, p.alpha);
        ctx.fill();
        ctx.restore();
      });
      raf = requestAnimationFrame(draw);
    }

    function start() {
      if (running) return;
      running = true;
      draw();
    }
    function stop() {
      running = false;
      if (raf) cancelAnimationFrame(raf);
      raf = null;
    }

    return {
      init(accent) {
        canvas = $('#petals');
        if (!canvas) return;
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        ctx = canvas.getContext('2d');
        color = accent || color;
        resize();
        items = [];
        resize();
        window.addEventListener('resize', resize);
        const hero = $('#hero');
        const io = new IntersectionObserver((entries) => {
          entries.forEach((entry) => (entry.isIntersecting ? start() : stop()));
        }, { threshold: 0.02 });
        io.observe(hero);
      },
      recolor() {
        const value = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
        if (value) color = value;
      }
    };
  })();

  /* ---------------- 统计数字 ---------------- */

  function renderHeroStats() {
    const box = $('#heroStats');
    if (!box || !state.site || state.site.showStats === false) {
      if (box) box.hidden = true;
      return;
    }
    const items = [
      { label: '篇文章', value: state.articles.length },
      { label: '件工具', value: state.shares.length },
      { label: '帧画面', value: state.gallery.length }
    ];
    box.innerHTML = items.map((item) =>
      '<div class="stat"><b data-count="' + item.value + '">0</b><span>' + item.label + '</span></div>'
    ).join('');
    $$('b[data-count]', box).forEach((el) => {
      const target = Number(el.dataset.count) || 0;
      const duration = 900;
      const startAt = performance.now();
      function tick(now) {
        const t = Math.min((now - startAt) / duration, 1);
        const eased = 1 - Math.pow(1 - t, 3);
        el.textContent = String(Math.round(target * eased));
        if (t < 1) requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    });
  }

  /* ---------------- 文章 ---------------- */

  function tagsOf(list, key) {
    const set = [];
    list.forEach((item) => (item[key] || []).forEach((t) => { if (set.indexOf(t) === -1) set.push(t); }));
    return set;
  }

  function renderArticleTags() {
    const box = $('#articleTags');
    const tags = tagsOf(state.articles, 'tags');
    if (!tags.length) { box.innerHTML = ''; return; }
    box.innerHTML = ['all'].concat(tags).map((tag) =>
      '<button class="chip' + (state.articleTag === tag ? ' is-active' : '') + '" data-tag="' + esc(tag) + '" type="button">' +
      (tag === 'all' ? '全部' : esc(tag)) + '</button>'
    ).join('');
    $$('.chip', box).forEach((btn) => {
      btn.addEventListener('click', () => {
        state.articleTag = btn.dataset.tag;
        renderAll();
      });
    });
  }

  function matchKeyword(item) {
    if (!state.keyword) return true;
    const haystack = [item.title, item.summary, item.desc, item.content].filter(Boolean).join(' ').toLowerCase();
    return haystack.indexOf(state.keyword) !== -1;
  }

  function renderArticles() {
    const box = $('#articlesList');
    let list = state.articles.filter(matchKeyword);
    if (state.articleTag !== 'all') list = list.filter((a) => (a.tags || []).indexOf(state.articleTag) !== -1);
    list = list.slice().sort((a, b) => {
      if (Boolean(b.pinned) !== Boolean(a.pinned)) return b.pinned ? 1 : -1;
      return String(b.publishedAt || '').localeCompare(String(a.publishedAt || ''));
    });
    state.view.articles = list;

    $('#articlesEmpty').hidden = list.length > 0;
    box.innerHTML = list.map((a) => {
      const locked = isLocked(a) && !a.dec;
      const thumb = a.cover
        ? '<img src="' + esc(a.cover) + '" alt="' + esc(a.title) + '" loading="lazy">'
        : '';
      const excerpt = locked
        ? '这篇以「加密」上锁，点开后输入口令才能阅读。'
        : (a.summary || window.TZMarkdown.plain(a.content, 110));
      return '<article class="article-card reveal-item' + (locked ? ' is-locked' : '') + '" data-id="' + esc(a.id) + '">' +
        (a.pinned ? '<span class="pin-badge">置顶</span>' : '') +
        (a.status === 'draft' ? '<span class="draft-badge">草稿</span>' : '') +
        (locked ? '<span class="lock-badge">' + LOCK_ICON + (Vault() ? esc(Vault().tag()) : '加密') + '</span>' : '') +
        '<div class="article-thumb' + (thumb ? '' : ' is-empty') + '">' + thumb + '</div>' +
        '<div class="article-body">' +
          '<div class="article-tags">' + (a.tags || []).slice(0, 3).map((t) => '<span class="tag">' + esc(t) + '</span>').join('') + '</div>' +
          '<h3>' + esc(a.title) + '</h3>' +
          '<p class="excerpt">' + esc(excerpt) + '</p>' +
          '<div class="article-foot">' +
            '<span>' + esc(a.author || '桃白') + '</span>' +
            '<span>' + formatDate(a.publishedAt) + '</span>' +
            '<span style="margin-left:auto">' + (a.views || 0) + ' 次阅读</span>' +
          '</div>' +
        '</div>' +
      '</article>';
    }).join('');

    $$('.article-card', box).forEach((card) => {
      card.addEventListener('click', () => { location.hash = '#/note/' + card.dataset.id; });
    });
    observeReveal(box);
  }

  /* ---------------- 分享 ---------------- */

  function renderShares() {
    const box = $('#sharesList');
    let list = state.shares.filter(matchKeyword);
    if (state.shareCat !== 'all') list = list.filter((s) => s.category === state.shareCat);
    list = list.slice().sort((a, b) => (Boolean(b.star) ? 1 : 0) - (Boolean(a.star) ? 1 : 0));
    state.view.shares = list;

    $('#sharesEmpty').hidden = list.length > 0;
    box.innerHTML = list.map((s) => {
      const initial = s.icon || (s.title || '?').slice(0, 2);
      return '<article class="share-card reveal-item is-openable" data-id="' + esc(s.id) + '">' +
        '<div class="share-head">' +
          '<div class="share-icon">' + esc(initial) + '</div>' +
          '<div>' +
            '<div class="share-title">' + esc(s.title) +
              (s.star ? '<span class="star">★</span>' : '') + '</div>' +
            '<div class="share-cat">' + (s.category === 'website' ? '网站 · WEB' : '软件 · APP') + '</div>' +
          '</div>' +
        '</div>' +
        '<p class="share-desc">' + esc(s.desc) + '</p>' +
        '<div class="share-foot">' +
          '<div class="platform-row">' + (s.platforms || []).slice(0, 3).map((p) => '<span class="platform">' + esc(p) + '</span>').join('') + '</div>' +
          '<div class="share-foot-acts">' +
            '<button class="share-more" type="button" data-id="' + esc(s.id) + '">详情</button>' +
            '<span class="share-sep" aria-hidden="true"></span>' +
            '<a class="share-link" href="' + esc(s.url) + '" target="_blank" rel="noopener" data-id="' + esc(s.id) + '">前往 <span>→</span></a>' +
          '</div>' +
        '</div>' +
      '</article>';
    }).join('');

    /* 整张卡片可点开详情；「前往」是外链，单独放行不拦截。
       键盘与读屏走卡片里的「详情」按钮，避免卡片里再套一层 role=button。 */
    $$('.share-card', box).forEach((card) => {
      card.addEventListener('click', () => { location.hash = '#/tool/' + card.dataset.id; });
    });
    $$('.share-more', box).forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        location.hash = '#/tool/' + btn.dataset.id;
      });
    });
    $$('.share-link', box).forEach((link) => {
      link.addEventListener('click', (e) => {
        e.stopPropagation();
        track('/api/shares/' + link.dataset.id + '/click', { method: 'POST' });
      });
    });
    observeReveal(box);
  }

  /* ---------------- 图库 ---------------- */

  function renderGalleryTags() {
    const box = $('#galleryTags');
    const tags = tagsOf(state.gallery, 'tags');
    if (!tags.length) { box.innerHTML = ''; return; }
    box.innerHTML = ['all'].concat(tags.slice(0, 8)).map((tag) =>
      '<button class="chip' + (state.galleryTag === tag ? ' is-active' : '') + '" data-tag="' + esc(tag) + '" type="button">' +
      (tag === 'all' ? '全部' : esc(tag)) + '</button>'
    ).join('');
    $$('.chip', box).forEach((btn) => {
      btn.addEventListener('click', () => {
        state.galleryTag = btn.dataset.tag;
        renderAll();
      });
    });
  }

  function renderGallery() {
    const box = $('#galleryGrid');
    let list = state.gallery.filter(matchKeyword);
    if (state.galleryTag !== 'all') list = list.filter((g) => (g.tags || []).indexOf(state.galleryTag) !== -1);
    list = list.slice().sort((a, b) => (a.order || 0) - (b.order || 0));
    state.view.gallery = list;

    $('#galleryEmpty').hidden = list.length > 0;
    box.innerHTML = list.map((g, index) => {
      const locked = isLocked(g);
      const src = gallerySrc(g);
      const tagName = Vault() ? Vault().tag() : '加密';
      return '<figure class="pic reveal-item' + (locked ? ' is-locked' : '') + '" data-index="' + index + '">' +
        (locked ? '<span class="lock-badge">' + LOCK_ICON + esc(tagName) + '</span>' : '') +
        (src
          ? '<img src="' + esc(src) + '" alt="' + esc(g.title || '') + '" loading="lazy">'
          : '<div class="pic-lock">' + LOCK_ICON + '<span>加密作品 · 点击解锁</span></div>') +
        '<figcaption class="pic-overlay">' +
          '<h3>' + esc(g.title || (locked ? '加密作品' : '')) + '</h3>' +
          (g.desc ? '<p>' + esc(g.desc) + '</p>' : '') +
          '<div class="pic-tags">' + (g.tags || []).slice(0, 3).map((t) => '<span class="tag">' + esc(t) + '</span>').join('') + '</div>' +
        '</figcaption>' +
      '</figure>';
    }).join('');

    $$('.pic', box).forEach((pic) => {
      pic.addEventListener('click', () => { openLightbox(Number(pic.dataset.index)).catch(() => {}); });
    });
    observeReveal(box);
  }

  /* ---------------- 灯箱 ---------------- */

  async function openLightbox(index) {
    const list = state.view.gallery;
    if (!list.length) return;
    state.lbList = list;
    state.lbIndex = Math.max(0, Math.min(index, list.length - 1));

    /* 加密图：先要口令、解密，再开灯箱；用户取消就什么都不做 */
    const item = list[state.lbIndex];
    if (item && isLocked(item) && !gallerySrc(item)) {
      if (!await ensureUnlocked('这张作品已加密，请输入口令')) return;
      try {
        await decryptGalleryItem(item);
      } catch (err) {
        toast('解密失败：' + (err.message || '未知错误'));
        return;
      }
      renderGallery();
      state.lbList = state.view.gallery;
      const back = state.view.gallery.findIndex((g) => g.id === item.id);
      state.lbIndex = back < 0 ? 0 : back;
    }

    const el = $('#lightbox');
    el.hidden = false;
    document.body.style.overflow = 'hidden';
    updateLightbox();
  }

  function updateLightbox() {
    const item = state.lbList[state.lbIndex];
    if (!item) return;
    const src = gallerySrc(item);
    const img = $('#lbImage');
    if (src) {
      img.hidden = false;
      img.src = src;
    } else {
      img.hidden = true;
      img.removeAttribute('src');
    }
    img.alt = item.title || '';
    $('#lbTitle').textContent = item.title || (isLocked(item) ? '加密作品' : '');
    $('#lbDesc').textContent = item.desc || '';
    $('#lbCount').textContent = (state.lbIndex + 1) + ' / ' + state.lbList.length;
  }

  function closeLightbox() {
    $('#lightbox').hidden = true;
    document.body.style.overflow = '';
  }

  function stepLightbox(delta) {
    const len = state.lbList.length;
    if (!len) return;
    state.lbIndex = (state.lbIndex + delta + len) % len;
    updateLightbox();
  }

  /* ---------------- 加密（观照集栏板 / 文章正文） ----------------
     静态产物里，打了「加密」标签的内容只留密文，字段会被导出脚本摘掉：
       · 文章：summary / content 没了，只留标题和密码学指纹
       · 图片：url / title / desc 没了，原图也从产物里清掉了
     所以未解锁时页面上根本没有可看的东西，解锁后才向 TZVault 要明文。 */

  const Vault = () => window.TZVault;

  const LOCK_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">' +
    '<rect x="4.5" y="10.5" width="15" height="9.5" rx="2"/><path d="M8 10.5V7.8a4 4 0 0 1 8 0v2.7"/></svg>';

  const isLocked = (item) => Boolean(item && item.locked);

  /* 图库里某张图当前可用的地址：解锁过就用解出来的 Blob URL */
  function gallerySrc(item) {
    return state.decUrls[item.id] || item.url || '';
  }

  async function ensureUnlocked(reason) {
    const V = Vault();
    if (!V || !V.hasVault()) {
      toast('这篇内容已加密，但站点缺少解锁数据（请重新发布）');
      return false;
    }
    return V.ensure(reason);
  }

  function decryptGalleryItem(item) {
    const V = Vault();
    if (!item || !isLocked(item) || state.decUrls[item.id]) return Promise.resolve();
    return V.decryptBlob(item.id).then((blob) => {
      if (!blob) throw new Error('缺少密文');
      state.decUrls[item.id] = URL.createObjectURL(blob);
      return V.decryptJson(item.id + ':meta');
    }).then((meta) => {
      if (meta) {
        item.title = meta.title || item.title;
        item.desc = meta.desc || item.desc;
      }
    });
  }

  /* 输入口令后把整区加密作品一次性解出来（张数通常不多，解完缓存着） */
  async function decryptLockedGallery() {
    const V = Vault();
    if (!V || !V.isUnlocked()) return;
    const targets = state.gallery.filter((g) => isLocked(g) && !state.decUrls[g.id]);
    for (let i = 0; i < targets.length; i += 1) {
      try {
        await decryptGalleryItem(targets[i]);
      } catch (err) { /* 单张失败不拦其余 */ }
    }
  }

  function renderVaultBar() {
    const bar = $('#vaultBar');
    if (!bar) return;
    const V = Vault();
    if (!V || !V.hasVault()) { bar.hidden = true; return; }

    const locked = state.gallery.filter(isLocked).length;
    if (!locked) { bar.hidden = true; return; }

    const open = V.isUnlocked();
    bar.hidden = false;
    bar.classList.toggle('is-open', open);
    const left = state.gallery.filter((g) => isLocked(g) && !gallerySrc(g)).length;
    $('#vaultBarTitle').textContent = open ? '加密内容已解锁' : '加密栏板';
    $('#vaultBarDesc').textContent = open
      ? (left
        ? '本区 ' + locked + ' 张加密作品，正在逐张解密…'
        : '本区 ' + locked + ' 张加密作品已可查看。关闭标签页后会自动重新上锁。')
      : '本区有 ' + locked + ' 张作品以「' + V.tag() + '」上锁，输入口令后方可查看。';
    $('#vaultBarBtn').textContent = open ? '重新上锁' : '输入口令解锁';
  }

  function revokeDecrypted() {
    Object.keys(state.decUrls).forEach((id) => {
      try { URL.revokeObjectURL(state.decUrls[id]); } catch (err) { /* 忽略 */ }
    });
    state.decUrls = {};
    state.articles.forEach((a) => { delete a.dec; });
  }

  function initVault() {
    const V = Vault();
    if (!V) return null;
    V.bindGate();

    const barBtn = $('#vaultBarBtn');
    if (barBtn) barBtn.addEventListener('click', async () => {
      if (V.isUnlocked()) { V.lock(); return; }
      const ok = await ensureUnlocked('输入口令后即可查看观照集里的加密作品');
      if (ok) toast('已解锁');
    });

    V.onChange((key) => {
      if (key) {
        decryptLockedGallery().then(renderAll).catch(() => renderAll());
      } else {
        revokeDecrypted();
        renderAll();
      }
    });
    return V;
  }

  /* ---------------- 阅读浮层 ---------------- */

  async function openReader(id) {
    const article = state.articles.find((a) => a.id === id);
    if (!article) { toast('找不到这篇文章'); return; }

    /* 加密文章：正文与摘要都不在产物里，先解锁再取明文 */
    if (isLocked(article) && !article.dec) {
      if (!await ensureUnlocked('这篇文章已加密，输入口令后即可阅读')) {
        if (location.hash.indexOf('#/note/') === 0) {
          history.replaceState(null, '', location.pathname + location.search);
        }
        return;
      }
      try {
        article.dec = await Vault().decryptJson(id);
      } catch (err) {
        toast('解密失败：' + (err.message || '未知错误'));
        return;
      }
      renderArticles();
    }
    const plain = article.dec || article;

    const reader = $('#reader');
    $('#readerTitle').textContent = article.title;
    $('#readerTags').innerHTML = (article.tags || []).map((t) => '<span class="tag">' + esc(t) + '</span>').join('');
    $('#readerMeta').innerHTML =
      '<span>' + esc(article.author || '桃白') + '</span>' +
      '<span>' + formatDate(article.publishedAt) + '</span>' +
      '<span>' + (article.views || 0) + ' 次阅读</span>';
    $('#readerBody').innerHTML = window.TZMarkdown.render(plain.content || '') ||
      '<p>（这篇文章还没有正文）</p>';
    $('#readerFoot').innerHTML =
      '<p>感谢读到此处。若有想法，欢迎在<a href="#about">关于</a>页留言。</p>';
    reader.hidden = false;
    document.body.style.overflow = 'hidden';
    $('#readerScroll').scrollTop = 0;
    $('#readerProgress').style.width = '0%';
    track('/api/articles/' + id + '/view', { method: 'POST' });
  }

  function closeReader() {
    $('#reader').hidden = true;
    document.body.style.overflow = '';
    if (location.hash.indexOf('#/note/') === 0) {
      history.replaceState(null, '', location.pathname + location.search);
    }
  }

  function initReader() {
    $$('[data-close]').forEach((el) => el.addEventListener('click', closeReader));
    $('#readerScroll').addEventListener('scroll', (e) => {
      const el = e.target;
      const max = el.scrollHeight - el.clientHeight;
      $('#readerProgress').style.width = (max > 0 ? (el.scrollTop / max) * 100 : 0) + '%';
    });
  }

  /* ---------------- 拾遗录 · 条目详情 ---------------- */

  function openShareDetail(id) {
    const item = state.shares.find((s) => s.id === id);
    if (!item) { toast('找不到这条收录'); return; }
    state.sdId = id;

    $('#sdIcon').textContent = item.icon || (item.title || '?').slice(0, 2);
    $('#sdTitle').textContent = item.title || '未命名';
    $('#sdSub').textContent = (item.category === 'website' ? '网站 · WEB' : '软件 · APP') +
      (item.star ? ' · 工作室力荐' : '');
    $('#sdTags').innerHTML = (item.tags || [])
      .map((t) => '<span class="tag">' + esc(t) + '</span>').join('');
    $('#sdDesc').innerHTML = richText(item.desc) ||
      '<p>（这条还没有写推荐理由）</p>';
    $('#sdPlats').innerHTML = (item.platforms || [])
      .map((p) => '<span class="platform">' + esc(p) + '</span>').join('');
    $('#sdActions').innerHTML =
      '<a class="btn btn-primary sd-go" href="' + esc(item.url) + '" target="_blank" rel="noopener" data-id="' + esc(item.id) + '">前往官网 <span>→</span></a>' +
      (Number(item.clicks || 0) > 0 ? '<span class="sd-clicks">已被打开 ' + Number(item.clicks) + ' 次</span>' : '');
    $$('.sd-go', $('#sdActions')).forEach((a) => {
      a.addEventListener('click', () => { track('/api/shares/' + a.dataset.id + '/click', { method: 'POST' }); });
    });

    const el = $('#shareDetail');
    if (el.hidden) {
      el.hidden = false;
      document.body.style.overflow = 'hidden';
      $('#sdScroll').scrollTop = 0;
      $('.detail-panel', el).focus();
    }
  }

  function closeShareDetail() {
    if ($('#shareDetail').hidden) return;
    $('#shareDetail').hidden = true;
    document.body.style.overflow = '';
    const back = state.sdId ? $('.share-card[data-id="' + state.sdId + '"]') : null;
    state.sdId = '';
    if (location.hash.indexOf('#/tool/') === 0) {
      history.replaceState(null, '', location.pathname + location.search);
    }
    if (back) {
      const hit = $('.share-more', back) || back;
      if (typeof hit.focus === 'function') hit.focus();
    }
  }

  function initShareDetail() {
    $$('[data-sd-close]').forEach((el) => el.addEventListener('click', closeShareDetail));
  }

  /* ---------------- 留言 ---------------- */

  function initContact() {
    const form = $('#contactForm');
    if (!form) return;
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const msg = $('#contactMsg');
      const data = Object.fromEntries(new FormData(form).entries());
      if (!data.content || !String(data.content).trim()) return;

      /* 静态托管没有后端：
         配置了 site.messageEndpoint（如 Formspree / Web3Forms 的免费表单地址）就提交过去，
         没配则引导用户走邮件，避免出现「提交成功但没人收到」的假象。 */
      if (state.staticMode) {
        const endpoint = (state.site && state.site.messageEndpoint) || '';
        if (!endpoint) {
          const mail = (state.site && state.site.email) || '';
          msg.textContent = mail
            ? '本站为静态部署，留言功能未开启，欢迎邮件联系：' + mail
            : '本站为静态部署，留言功能未开启。';
          return;
        }
        try {
          const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify(data)
          });
          if (!res.ok) throw new Error('发送失败，请稍后再试');
          form.reset();
          msg.textContent = '已经收到了，谢谢。';
          toast('留言已寄出');
          setTimeout(() => { msg.textContent = ''; }, 5000);
        } catch (err) {
          msg.textContent = err.message;
        }
        return;
      }

      try {
        await api('/api/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data)
        });
        form.reset();
        msg.textContent = '已经收到了，谢谢。';
        toast('留言已寄出');
        setTimeout(() => { msg.textContent = ''; }, 5000);
      } catch (err) {
        msg.textContent = err.message;
      }
    });
  }

  /* ---------------- 路由 ---------------- */

  function handleHash() {
    const hash = location.hash || '';
    if (hash.indexOf('#/note/') === 0) {
      if (!$('#shareDetail').hidden) {
        $('#shareDetail').hidden = true;
        document.body.style.overflow = '';
        state.sdId = '';
      }
      openReader(decodeURIComponent(hash.slice(7)));
      return;
    }
    if (hash.indexOf('#/tool/') === 0) {
      if (!$('#reader').hidden) {
        $('#reader').hidden = true;
        document.body.style.overflow = '';
      }
      openShareDetail(decodeURIComponent(hash.slice(7)));
      return;
    }
    if (!$('#reader').hidden) {
      $('#reader').hidden = true;
      document.body.style.overflow = '';
    }
    if (!$('#shareDetail').hidden) {
      $('#shareDetail').hidden = true;
      document.body.style.overflow = '';
      state.sdId = '';
    }
  }

  /* ---------------- 渲染总入口 ---------------- */

  function renderAll() {
    renderArticleTags();
    renderArticles();
    renderShares();
    renderGalleryTags();
    renderGallery();
    renderVaultBar();
    Petals.recolor();
  }

  /* ---------------- 启动 ---------------- */

  async function boot() {
    initTheme();
    initNav();
    initReveal();
    initReader();
    initShareDetail();
    initContact();

    $('#shareFilter').addEventListener('click', (e) => {
      const btn = e.target.closest('.seg-btn');
      if (!btn) return;
      state.shareCat = btn.dataset.cat;
      $$('.seg-btn', $('#shareFilter')).forEach((b) => b.classList.toggle('is-active', b === btn));
      renderShares();
    });

    document.addEventListener('keydown', (e) => {
      if ($('#lightbox').hidden === false) {
        if (e.key === 'Escape') closeLightbox();
        if (e.key === 'ArrowLeft') stepLightbox(-1);
        if (e.key === 'ArrowRight') stepLightbox(1);
        return;
      }
      if (!$('#reader').hidden && e.key === 'Escape') closeReader();
      if (!$('#shareDetail').hidden && e.key === 'Escape') closeShareDetail();
    });

    $$('[data-lb-close]').forEach((el) => el.addEventListener('click', closeLightbox));
    $('[data-lb-prev]').addEventListener('click', () => stepLightbox(-1));
    $('[data-lb-next]').addEventListener('click', () => stepLightbox(1));

    window.addEventListener('hashchange', handleHash);

    /* 加密板块：先挂事件、再读产物里的 vault.json。
       没有加密内容时 hasVault() 为 false，整条链路静默不打扰访客。 */
    const vault = initVault();

    try {
      const [siteRes, articleRes, shareRes, galleryRes] = await Promise.all([
        loadData('/api/site', '/data/site.json', (d) => d && d.site && d.site.name),
        loadData('/api/articles', '/data/articles.json', (d) => d && Array.isArray(d.items)),
        loadData('/api/shares', '/data/shares.json', (d) => d && Array.isArray(d.items)),
        loadData('/api/gallery', '/data/gallery.json', (d) => d && Array.isArray(d.items)),
        vault ? vault.load() : null
      ]);
      applySite(siteRes.site);
      state.articles = articleRes.items || [];
      state.shares = shareRes.items || [];
      state.gallery = galleryRes.items || [];
      renderAll();
      renderHeroStats();
      Petals.init(siteRes.site.accent);
      /* 会话里已经解过锁（比如同一标签页刷新），直接把这批图也解出来 */
      if (vault && vault.isUnlocked()) {
        decryptLockedGallery().then(renderAll).catch(() => {});
      }
      handleHash();
    } catch (err) {
      toast('数据加载失败：' + err.message);
    }

    track('/api/visit', { method: 'POST' });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
