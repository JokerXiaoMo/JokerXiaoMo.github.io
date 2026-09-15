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
    /* 加密：解锁后的图片 Blob URL（按 id 缓存），刷新页面时随内存一起失效 */
    decUrls: {},
    /* 正在解密中的条目 id —— 纯 JS 解一张 5 MB 的图要一秒多，
       卡片上必须有可见状态，否则访客以为「点了没反应」 */
    decrypting: {},
    /* 正在解密中的进度文案（按 id）：下载 5 MB 在国内链路上要好几秒，
       只写「正在解密…」看不出是在动还是卡死了 */
    decProgress: {},
    /* 正在进行的解密任务（按 id）。同一张图会被两条路径同时要求解开
       （点卡片开灯箱、以及解锁回调里的批量解），要复用同一个 promise，
       否则 5 MB 会被下载两遍 —— 国内链路下这就是成功与失败的分界。 */
    decPending: {},
    /* 已经播过进场动画的条目 id。重渲染时直接带上 is-in，
       不再让全部卡片重新淡入一遍（那看起来就是「所有小窗都在闪」）。 */
    revealed: new Set(),
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

  /* 卡片上只放第一段。推荐理由常常分了好几段、还带小标题，
     整段塞进卡片会把「它做什么」这类小标题挤成半句话，读起来像病句；
     完整内容留给点开后的详情浮层。 */
  function leadOf(text) {
    const src = String(text == null ? '' : text).replace(/\r\n/g, '\n');
    const first = src.split(/\n{2,}/)[0] || '';
    return first.replace(/\s*\n\s*/g, ' ').trim();
  }

  let toastTimer = null;

  /* kind='error' 的提示留久一点：解密失败这类事，2.6 秒往往还没看完就没了 */
  function toast(message, kind) {
    const el = $('#toast');
    el.textContent = message;
    el.classList.toggle('is-error', kind === 'error');
    el.classList.add('is-show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.classList.remove('is-show');
      el.classList.remove('is-error');
    }, kind === 'error' ? 5000 : 2600);
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
    const root = document.documentElement;
    const saved = localStorage.getItem('tz-theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const theme = saved || (prefersDark ? 'dark' : 'light');
    root.setAttribute('data-theme', theme);
    $('#themeToggle').addEventListener('click', () => {
      const next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      /* 只在切换这 360ms 内开放颜色过渡，平时不留着 ——
         常驻的话，所有 hover 与按下反馈都会被它拖慢。 */
      root.classList.add('is-theme-switching');
      window.setTimeout(() => root.classList.remove('is-theme-switching'), 360);
      root.setAttribute('data-theme', next);
      try { localStorage.setItem('tz-theme', next); } catch (err) { /* 隐私模式读不了就算了 */ }
    });
  }

  /* ---------------- 导航 ---------------- */

  function initNav() {
    const nav = $('#siteNav');
    const progress = $('#scrollProgress');
    const links = () => $$('.nav-links a');

    function onScroll() {
      const y = window.scrollY;
      const vh = window.innerHeight || 1;
      nav.classList.toggle('is-scrolled', y > 40);
      const height = document.documentElement.scrollHeight - vh;
      progress.style.width = (height > 0 ? (y / height) * 100 : 0) + '%';

      /* hero 随滚动轻微上移并淡出。幅度刻意压得很小 ——
         再大一点就从「呼吸」变成「表演」了。 */
      const hero = $('#hero');
      if (hero) hero.style.setProperty('--scroll', String(Math.min(1, Math.max(0, y / vh))));

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
          /* 记下来：这块 DOM 将来被重渲染时直接带 is-in，
             不让已经亮过的卡片再淡入一遍（那会看起来像「全部小窗在闪」） */
          if (entry.target.dataset.id) state.revealed.add(entry.target.dataset.id);
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.08, rootMargin: '0px 0px -30px 0px' });
    $$('.reveal-item:not(.is-in)', scope || document).forEach((el) => observer.observe(el));
  }

  /* ---------------- 首屏目录 ----------------
     这里原来是一排「实时统计数字」（1 篇文章 / 1 件工具 / 4 帧画面）。
     数字本身没说错，但对第一次来的人没有任何用处，反而等于自曝「本站几乎是空的」。
     换成目录：期号 + 栏目名 + 数量，点一下就到那一段。 */
  function renderHeroIndex() {
    const box = $('#heroIndex');
    if (!box) return;
    if (!state.site || state.site.showStats === false) { box.hidden = true; return; }
    const items = [
      { no: '01', key: 'articles', name: '桃花笺', unit: '篇' },
      { no: '02', key: 'shares', name: '拾遗录', unit: '条' },
      { no: '03', key: 'gallery', name: '观照集', unit: '张' }
    ];
    box.hidden = false;
    box.innerHTML = items.map((item) =>
      '<a class="hero-index-item" href="#' + esc(item.key) + '">' +
        '<span class="hi-no">' + item.no + '</span>' +
        '<span class="hi-name">' + esc(item.name) + '</span>' +
        '<span class="hi-count">' + (state[item.key] || []).length + ' ' + item.unit + '</span>' +
      '</a>'
    ).join('');
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
      return '<article class="share-card reveal-item is-openable' +
        (state.revealed.has(s.id) ? ' is-in' : '') + '" data-id="' + esc(s.id) + '">' +
        '<div class="share-head">' +
          '<div class="share-icon">' + esc(initial) + '</div>' +
          '<div>' +
            '<div class="share-title">' + esc(s.title) +
              (s.star ? '<span class="star">★</span>' : '') + '</div>' +
            '<div class="share-cat">' + (s.category === 'website' ? '网站 · WEB' : '软件 · APP') + '</div>' +
          '</div>' +
        '</div>' +
        '<p class="share-desc">' + esc(leadOf(s.desc)) + '</p>' +
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

  /* 单张图卡的 HTML。抽出来是为了「只换一张卡片」时能复用同一份模板 ——
     整块重渲染会让所有卡片重播一遍进场动画，看起来就是全部小窗都在闪。 */
  function picHtml(g, index) {
    /* 和文章卡片一样：解开并渲染出图之后就不要再挂锁标/遮罩了 */
    const locked = isLocked(g) && !state.decUrls[g.id];
    const busy = Boolean(state.decrypting[g.id]);
    const src = gallerySrc(g);
    const tagName = Vault() ? Vault().tag() : '加密';
    /* 图块内没有别的可交互元素，所以整块做 role="button" 是安全的；
       键盘可达性不能只靠鼠标点击。 */
    const label = (g.title || (locked ? '加密作品' : '图片')) + (locked ? '，需要口令才能查看' : '，查看大图');
    /* 下载 5 MB 要好几秒，只写「正在解密…」会让人分不清是在动还是卡死了 */
    const busyText = busy ? (state.decProgress[g.id] || '正在解密…') : '加密作品 · 点击解锁';
    return '<figure class="pic reveal-item' + (locked ? ' is-locked' : '') + (busy ? ' is-decrypting' : '') +
      (state.revealed.has(g.id) ? ' is-in' : '') + '"' +
      ' data-index="' + index + '" data-id="' + esc(g.id) + '"' +
      ' tabindex="0" role="button" aria-label="' + esc(label) + '"' +
      (busy ? ' aria-busy="true"' : '') + '>' +
      (locked ? '<span class="lock-badge">' + LOCK_ICON + esc(tagName) + '</span>' : '') +
      (src
        ? '<img src="' + esc(src) + '" alt="' + esc(g.title || '') + '" loading="lazy">'
        : '<div class="pic-lock">' + LOCK_ICON + '<span>' + esc(busyText) + '</span></div>') +
      '<figcaption class="pic-overlay">' +
        /* 锁态下不再重复写标题：锁位里已经写了「加密作品」（未解锁时 title 本来就是空的） */
        (locked ? '' : '<h3>' + esc(g.title || '') + '</h3>') +
        (g.desc ? '<p>' + esc(g.desc) + '</p>' : '') +
        '<div class="pic-tags">' + (g.tags || []).slice(0, 3).map((t) => '<span class="tag">' + esc(t) + '</span>').join('') + '</div>' +
      '</figcaption>' +
    '</figure>';
  }

  /* 图块的点击/键盘与图片淡入。renderGallery 与 updateGalleryCard 都走这里，
     免得两边的行为慢慢漂移。 */
  function bindPic(pic) {
    const open = () => { openLightbox(Number(pic.dataset.index)).catch(() => {}); };
    pic.addEventListener('click', open);
    pic.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
    });
    hydratePicImg(pic);
  }

  /* 图片淡入的兜底：缓存命中时图片在绑定事件之前就已经加载完，
     不会再派发 load，所以必须先查 img.complete，否则它会一直停在全透明。
     error 也一并标记 —— 破图占位总比一片空白好。 */
  function hydratePicImg(pic) {
    $$('img', pic).forEach((img) => {
      if (img.complete && img.naturalWidth > 0) { img.classList.add('is-loaded'); return; }
      const done = () => img.classList.add('is-loaded');
      img.addEventListener('load', done, { once: true });
      img.addEventListener('error', done, { once: true });
    });
  }

  function renderGallery() {
    const box = $('#galleryGrid');
    let list = state.gallery.filter(matchKeyword);
    if (state.galleryTag !== 'all') list = list.filter((g) => (g.tags || []).indexOf(state.galleryTag) !== -1);
    list = list.slice().sort((a, b) => (a.order || 0) - (b.order || 0));
    state.view.gallery = list;

    $('#galleryEmpty').hidden = list.length > 0;
    box.innerHTML = list.map((g, index) => picHtml(g, index)).join('');
    $$('.pic', box).forEach(bindPic);
    observeReveal(box);
  }

  /* 只换掉那一张卡片。解锁一张图之后走这里，而不是 renderGallery()：
     整块重建会把页面上所有卡片重新淡入一遍，用户看到的就是「全部小窗都会闪」。 */
  function updateGalleryCard(id) {
    const box = $('#galleryGrid');
    if (!box) return;
    const item = state.view.gallery.find((g) => g.id === id);
    const index = state.view.gallery.indexOf(item);
    if (index < 0) return;
    const old = box.querySelector('.pic[data-index="' + index + '"]');
    if (!old) { renderGallery(); return; }   /* 没找到就退回整块重建，至少状态是对的 */

    /* 已经是目标状态就别再换节点 —— 换节点本身也是一次可见的重绘。
       解锁回调与点卡片两条路径都会走到这里，去重后只换一次。 */
    const img = old.querySelector('img');
    if (state.decUrls[id] && img && img.src.indexOf('blob:') === 0 &&
      !old.classList.contains('is-locked') && !old.classList.contains('is-decrypting')) {
      return;
    }

    const holder = document.createElement('div');
    holder.innerHTML = picHtml(item, index);
    const next = holder.firstElementChild;
    if (!next) return;
    next.style.setProperty('--d', old.style.getPropertyValue('--d') || '0ms');
    old.replaceWith(next);
    bindPic(next);
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
      if (!await ensureUnlocked(item.id, '这张作品单独加了密，输入它的口令才能查看')) return;
      try {
        await decryptGalleryItem(item);
      } catch (err) {
        /* 失败的原因要能分清：下不完和口令不对是两回事，给的话术也不同 */
        toast(err.message || '解密失败，请重试', 'error');
        paintDecrypting();
        return;
      }
      /* 只换这一张卡片。整块 renderGallery() 会让所有卡片重播进场动画，
         看起来就是「全部小窗都在闪」 */
      updateGalleryCard(item.id);
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

  async function ensureUnlocked(id, reason) {
    const V = Vault();
    if (!V || !V.hasVault()) {
      toast('这条内容已加密，但站点缺少解锁数据（请重新发布）');
      return false;
    }
    return V.ensure(id, reason);
  }

  /* 解密期间把对应卡片切成「正在解密…」
     一张 5 MB 的图在国内链路上要好几秒，光转个圈说明不了任何事，
     所以把「已收到多少 / 共多少」实时写进卡片，让人知道它确实在动。 */
  function paintDecrypting() {
    const box = $('#galleryGrid');
    if (!box) return;
    $$('.pic', box).forEach((pic) => {
      const g = state.view.gallery[Number(pic.dataset.index)];
      const busy = Boolean(g && state.decrypting[g.id]);
      pic.classList.toggle('is-decrypting', busy);
      if (busy) pic.setAttribute('aria-busy', 'true');
      else pic.removeAttribute('aria-busy');
      const label = pic.querySelector('.pic-lock span');
      if (label) label.textContent = busy ? (state.decProgress[g.id] || '正在解密…') : '加密作品 · 点击解锁';
    });
  }

  /* 解一张加密图。
   *
   * 两个刻意的设计：
   *   ① 同一个 id 只跑一份任务。点卡片开灯箱与解锁回调的批量解会同时要求解这一张，
   *      不复用的话 5 MB 要下载两遍 —— 在国内链路上这就是成功与失败的分界。
   *   ② 不收尾也不整块重渲染。状态清了就走，界面交给调用方按 id 局部更新。
   */
  function decryptGalleryItem(item) {
    const V = Vault();
    if (!item) return Promise.resolve();
    if (state.decUrls[item.id]) return Promise.resolve();
    if (!isLocked(item)) return Promise.resolve();
    if (state.decPending[item.id]) return state.decPending[item.id];

    state.decrypting[item.id] = true;
    state.decProgress[item.id] = '正在连接…';
    paintDecrypting();

    const task = (async () => {
      try {
        const blob = await V.decryptBlob(item.id, (got, total) => {
          state.decProgress[item.id] = total
            ? '正在接收 ' + (got / 1048576).toFixed(1) + ' / ' + (total / 1048576).toFixed(1) + ' MB'
            : '正在接收 ' + (got / 1048576).toFixed(1) + ' MB';
          paintDecrypting();
        });
        if (!blob) throw new Error('这张作品在线上缺少密文，请重新发布一次');
        state.decProgress[item.id] = '正在解密…';
        paintDecrypting();
        state.decUrls[item.id] = URL.createObjectURL(blob);
        const meta = await V.decryptMeta(item.id).catch(() => null);
        if (meta) {
          item.title = meta.title || item.title;
          item.desc = meta.desc || item.desc;
        }
      } finally {
        delete state.decrypting[item.id];
        delete state.decProgress[item.id];
        delete state.decPending[item.id];
        paintDecrypting();
      }
    })();

    state.decPending[item.id] = task;
    return task;
  }

  /* 把「已经拿到密钥的那几条」解出来。
     逐条加密之后不再有「一开全开」，所以这里只认 isUnlocked 的条目。
     解好一条就当场换掉那一张卡片，不整块重渲染。 */
  async function decryptUnlockedGallery() {
    const V = Vault();
    if (!V || !V.unlockedCount()) return;
    const targets = state.gallery.filter((g) => isLocked(g) && V.isUnlocked(g.id) && !state.decUrls[g.id]);
    for (let i = 0; i < targets.length; i += 1) {
      try {
        await decryptGalleryItem(targets[i]);
        updateGalleryCard(targets[i].id);
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

    const opened = state.gallery.filter((g) => isLocked(g) && V.isUnlocked(g.id)).length;
    bar.hidden = false;
    bar.classList.toggle('is-open', opened > 0);

    $('#vaultBarTitle').textContent = opened
      ? '已解锁 ' + opened + ' / ' + locked + ' 张'
      : '加密栏板';
    /* 上锁不做成按钮 —— 刷新页面就全部重新上锁，机制只有这一个，才不会被问「上锁有什么意义」 */
    $('#vaultBarDesc').textContent = opened
      ? '已解开 ' + opened + ' / ' + locked + ' 张，其余仍锁着。刷新页面即全部重新上锁。'
      : '本区有 ' + locked + ' 张作品以「' + V.tag() + '」分别上锁 —— 点开哪一张，就输入哪一张的口令。';
  }

  function revokeDecrypted() {
    Object.keys(state.decUrls).forEach((id) => {
      try { URL.revokeObjectURL(state.decUrls[id]); } catch (err) { /* 忽略 */ }
    });
    state.decUrls = {};
    state.decrypting = {};
    state.decProgress = {};
    state.decPending = {};
    state.articles.forEach((a) => { delete a.dec; });
  }

  function initVault() {
    const V = Vault();
    if (!V) return null;
    V.bindGate();

    /* 栏板上没有「上锁」按钮：解锁态只活在内存里，刷新页面自然全部上锁 */

    V.onChange((keys) => {
      if (keys && Object.keys(keys).length) {
        /* 解锁了：只动受影响的卡片与栏板文案。
           这里刻意不调 renderAll()/renderGallery() —— 整块重建会把所有卡片
           重新播一遍进场动画，用户看到的就是「全部小窗都在闪」。 */
        renderVaultBar();
        paintDecrypting();
        decryptUnlockedGallery().catch(() => {});
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
      if (!await ensureUnlocked(id, '《' + (article.title || '这篇文章') + '》单独加了密，输入它的口令才能阅读')) {
        if (location.hash.indexOf('#/note/') === 0) {
          history.replaceState(null, '', location.pathname + location.search);
        }
        return;
      }
      try {
        article.dec = await Vault().decryptJson(id);
      } catch (err) {
        /* decryptJson 已经把无名错误翻译过，这里不要再套一层「解密失败：未知错误」 */
        toast(err.message || '这篇文章解不开，请重试', 'error');
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
      '<p>读完了？有想法的话，去<a href="#about">关于</a>页留一句话。</p>';
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
      (item.star ? ' · 工作室推荐' : '');
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

  /* ---------------- 留言 ----------------
     纯静态托管没有后端。配置了 site.messageEndpoint 就把表单提交过去；
     没配就**不摆表单**，直接把邮箱亮出来 —— 一个点了没人收的假表单，
     比干脆没有表单更劝退，访客会以为网站坏了。 */
  function renderContact() {
    const form = $('#contactForm');
    const mailBox = $('#contactMail');
    if (!form || !mailBox) return;
    const endpoint = (state.site && state.site.messageEndpoint) || '';
    const mail = (state.site && state.site.email) || '';
    const usable = !state.staticMode || Boolean(endpoint);
    form.hidden = !usable;
    mailBox.hidden = usable || !mail;
    if (!usable && mail) {
      mailBox.innerHTML = '本站是纯静态托管，没接后端，表单寄不出去。有事直接发邮件：' +
        '<a href="mailto:' + esc(mail) + '">' + esc(mail) + '</a>';
    }
  }

  function initContact() {
    const form = $('#contactForm');
    if (!form) return;
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const msg = $('#contactMsg');
      const data = Object.fromEntries(new FormData(form).entries());
      if (!data.content || !String(data.content).trim()) return;

      if (state.staticMode) {
        const endpoint = (state.site && state.site.messageEndpoint) || '';
        /* 没有收件端点时表单本来就不显示，这里只是兜底，别再给一句没用的提示 */
        if (!endpoint) return;
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

    /* 手机上的左右滑动切图：箭头按钮在窄屏上既小又容易点错 */
    (function initLightboxSwipe() {
      const el = $('#lightbox');
      let sx = 0;
      let sy = 0;
      let tracking = false;
      el.addEventListener('touchstart', (e) => {
        if (e.touches.length !== 1) { tracking = false; return; }
        tracking = true;
        sx = e.touches[0].clientX;
        sy = e.touches[0].clientY;
      }, { passive: true });
      el.addEventListener('touchend', (e) => {
        if (!tracking) return;
        tracking = false;
        const t = e.changedTouches[0];
        const dx = t.clientX - sx;
        const dy = t.clientY - sy;
        /* 横向位移要够大、且明显大于纵向，免得把「下滑关闭」误判成翻页 */
        if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.4) {
          stepLightbox(dx < 0 ? 1 : -1);
        }
      }, { passive: true });
    })();

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
      renderHeroIndex();
      renderContact();
      /* 满树桃花 + 十年之约（tree.js）。万一这个脚本没加载上，
         首屏只是少一棵树，其余部分照常工作。 */
      if (window.TZTree) window.TZTree.init(siteRes.site);
      /* 解锁态不跨刷新保留 —— 每次打开页面都从「全部上锁」开始 */
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
