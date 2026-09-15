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
    /* view.gallery 是「展平后的可见图」，灯箱前后翻页走它；
       view.blocks 是渲染用的分块结果（单张 / 图组），两者指向同一批对象。 */
    view: { articles: [], shares: [], gallery: [], blocks: [] },
    articleTag: 'all',
    galleryTag: 'all',
    shareCat: 'all',
    keyword: '',
    lbList: [],
    lbIndex: 0,
    /* 灯箱底部那排「同组缩略图」当前是哪个图组 —— 只用来避免每次翻页都重建一遍 DOM */
    lbStripKey: null,
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

  /* ---------------- 图组：多图叠成一张卡 ----------------
     数据里只多一个 stack 字段（值就是组名本身）：填了同一个名字的图，
     前台叠成一张卡，点开才把全部摊出来。
     加密与导出链路一点没动 —— 组里每张图仍然各自独立加密、各自要自己的口令。 */

  const REDUCED_MOTION = () =>
    Boolean(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  /* 把排好序的图库切成「块」：有 stack 的按组归并，没有的各成一块。
     只剩一张的图组没必要叠着显示，退回单张。 */
  function buildBlocks(list) {
    const out = [];
    const byKey = new Map();
    list.forEach((g) => {
      const key = String(g.stack || '').trim();
      if (!key) { out.push({ kind: 'one', key: '', members: [g] }); return; }
      let block = byKey.get(key);
      if (!block) { block = { kind: 'stack', key: key, members: [] }; byKey.set(key, block); out.push(block); }
      block.members.push(g);
    });
    out.forEach((b) => { if (b.kind === 'stack' && b.members.length < 2) b.kind = 'one'; });
    return out;
  }

  /* 叠图卡的 HTML。
     刻意不把整张卡做成 role="button" —— 卡片里还有可点的缩略图，
     交互元素不能套交互元素。封面自己是个 <button>（鼠标、键盘、读屏都能展开），
     说明文字单独放在一层 aria-hidden 的浮层里，只负责好看。 */
  function stackHtml(block, startIndex) {
    const cover = block.members[0];
    const count = block.members.length;
    const tagName = Vault() ? Vault().tag() : '加密';
    const coverLocked = isLocked(cover) && !state.decUrls[cover.id];
    const coverBusy = Boolean(state.decrypting[cover.id]);
    const src = gallerySrc(cover);
    const lockText = coverBusy ? (state.decProgress[cover.id] || '正在解密…') : '加密作品 · 点击展开';
    /* 「展开/收起」这个动作词在 setStackOpen 里按状态改写 —— 固定写死的话，
       摊开之后那句还写着「点击展开」，读屏念出来和 aria-expanded 是矛盾的 */
    const label = '图组「' + block.key + '」共 ' + count + ' 张' + (coverLocked ? '，封面已加密' : '') +
      (!coverLocked && cover.title ? '，第一张：' + cover.title : '');
    const panelId = 'stack-panel-' + cover.id;

    const thumbs = block.members.map((g, i) => {
      const locked = isLocked(g) && !state.decUrls[g.id];
      const busy = Boolean(state.decrypting[g.id]);
      const s = gallerySrc(g);
      const name = g.title || (locked ? '加密作品' : '第 ' + (i + 1) + ' 张');
      return '<li class="stack-item">' +
        '<button class="stack-thumb' + (locked ? ' is-locked' : '') + (busy ? ' is-decrypting' : '') + '"' +
          ' type="button" data-index="' + (startIndex + i) + '" data-id="' + esc(g.id) + '"' +
          ' aria-label="' + esc(name + (locked ? '，需要口令才能查看' : '，查看大图')) + '">' +
          (s
            ? '<img src="' + esc(s) + '" alt="" loading="lazy" decoding="async">'
            : '<span class="stack-thumb-lock">' + LOCK_ICON + '<em>' + esc(busy ? '解密中…' : tagName) + '</em></span>') +
          '<span class="stack-thumb-name">' + esc(locked ? '加密' : name) + '</span>' +
        '</button>' +
      '</li>';
    }).join('');

    return '<figure class="pic pic-stack reveal-item' + (state.revealed.has(cover.id) ? ' is-in' : '') +
      (coverLocked ? ' stack-locked' : '') + '"' +
      ' data-stack="' + esc(block.key) + '" data-id="' + esc(cover.id) + '">' +
      '<span class="stack-deck" aria-hidden="true"><i></i><i></i></span>' +
      '<button class="stack-cover" type="button" data-act="toggle" aria-expanded="false"' +
        ' aria-controls="' + esc(panelId) + '" data-label="' + esc(label) + '"' +
        ' aria-label="' + esc(label + '，点击展开') + '">' +
        (src
          ? '<img src="' + esc(src) + '" alt="" loading="lazy" decoding="async">'
          : '<span class="pic-lock">' + LOCK_ICON + '<span>' + esc(lockText) + '</span></span>') +
      '</button>' +
      '<span class="pic-overlay" aria-hidden="true">' +
        (coverLocked ? '' : '<span class="ov-t">' + esc(cover.title || '') + '</span>') +
      '</span>' +
      /* 这两个角标只是给眼睛看的，内容已经写进封面的 aria-label 了，
         不标 aria-hidden 的话读屏会把「N 张」「加密」重复念一遍 */
      '<span class="stack-count" aria-hidden="true">' + count + ' 张</span>' +
      (coverLocked ? '<span class="lock-badge" aria-hidden="true">' + LOCK_ICON + esc(tagName) + '</span>' : '') +
      '<div class="stack-panel" id="' + esc(panelId) + '">' +
        '<div class="stack-panel-inner">' +
          '<div class="stack-head">' +
            '<strong>' + esc(block.key) + '</strong>' +
            '<span>' + count + ' 张 · 第一张作封面</span>' +
          '</div>' +
          '<ul class="stack-thumbs">' + thumbs + '</ul>' +
          '<button class="stack-collapse" type="button" data-act="collapse">收起</button>' +
        '</div>' +
      '</div>' +
    '</figure>';
  }

  /* 展开 / 收起。用 JS 量出真实高度再过渡：
     height:auto 本身没法做 transition，而 grid-template-rows 0fr→1fr
     在部分浏览器上还没拿到过渡支持。

     ⚠️ 这里有三个坑，都是踩过才知道的：
       ① transitionend 会冒泡 —— 面板里任何子元素的过渡（缩略图描边、位移）
          都会冒上来。不校验 target / propertyName，展开动画就会被提前截断；
          而一旦加了 {once:true}，被子元素消耗掉之后面板自己的那次就再也收不到。
       ② 动画没播完就反向收起时，scrollHeight 量的是内容全高而不是「当前高度」，
          直接用它会先弹到满高再合。得先读一次 computed。
       ③ 连续点击必须清掉上一轮的监听与兜底定时器，否则旧的定时器会把新一轮
          动画瞬间切到 height:auto。 */
  const STACK_MS = 480;                 /* 兜底用，必须略长于 CSS 的 --dur-3（420ms） */
  const stackAnim = new WeakMap();      /* 卡片 → 本轮动画的 {timer, settle} */
  const stackFan = new WeakMap();       /* 卡片 → 交错入场动画的收尾定时器 */

  /* 缩略图「一张张浮现」只在真的从收起到展开时播一次。
     要是绑在 is-open 上，解密完成每重画一次卡片就会重播一遍，
     组里有几张就要闪几下 —— 那正是这个项目早就修过的「全部小窗都在闪」。 */
  function setFanning(card, on) {
    const old = stackFan.get(card);
    if (old) { clearTimeout(old); stackFan.delete(card); }
    card.classList.remove('is-fanning');
    if (!on) return;
    card.classList.add('is-fanning');
    stackFan.set(card, setTimeout(() => {
      card.classList.remove('is-fanning');
      stackFan.delete(card);
    }, 760));
  }

  function clearStackAnim(card) {
    const a = stackAnim.get(card);
    if (!a) return;
    clearTimeout(a.timer);
    const panel = card.querySelector('.stack-panel');
    if (panel && a.settle) panel.removeEventListener('transitionend', a.settle);
    stackAnim.delete(card);
  }

  function setStackOpen(card, on, silent) {
    const panel = card.querySelector('.stack-panel');
    if (!panel) return;
    const cover = card.querySelector('.stack-cover');
    clearStackAnim(card);

    if (cover) cover.setAttribute('aria-expanded', on ? 'true' : 'false');
    /* 收起过渡的这四百多毫秒里面板还是 visible，里面的缩略图仍能被 Tab 到。
       inert 直接把它从可聚焦集合里摘出去（老浏览器不认这个属性，忽略即可）。 */
    if ('inert' in HTMLElement.prototype) panel.inert = !on;
    /* 封面是锁形占位时那句提示也得跟着变 —— 摊开着却写着「点击展开」，
       读屏念出来会和 aria-expanded 打架。正在解密时的进度文案不能覆盖。
       可见文字与无障碍名要一致（WCAG 2.5.3）：读屏与语音控制都靠 aria-label，
       它必须把「点击展开 / 点击收起」这几个字也带上。 */
    const lockLabel = cover ? cover.querySelector('.pic-lock span') : null;
    const busy = Boolean(state.decrypting[card.dataset.id]);
    if (lockLabel && !busy) {
      lockLabel.textContent = on ? '加密作品 · 点击收起' : '加密作品 · 点击展开';
    }
    if (cover && cover.dataset.label && !busy) {
      cover.setAttribute('aria-label', cover.dataset.label + (on ? '，点击收起' : '，点击展开'));
    }
    card.classList.toggle('is-open', on);
    setFanning(card, on && !silent && !REDUCED_MOTION());

    if (silent || REDUCED_MOTION()) {
      panel.style.height = on ? 'auto' : '0px';
      return;
    }
    if (on) {
      panel.style.height = panel.scrollHeight + 'px';
      const settle = (ev) => {
        if (ev && (ev.target !== panel || ev.propertyName !== 'height')) return;
        clearStackAnim(card);
        /* 期间可能又点了收起，别把已经合上的面板重新撑开 */
        if (card.classList.contains('is-open')) panel.style.height = 'auto';
      };
      panel.addEventListener('transitionend', settle);
      stackAnim.set(card, { timer: setTimeout(settle, STACK_MS), settle: settle });
    } else {
      /* 先钉住当前真实高度、强制一次样式计算，再收到 0，才有过渡可看 */
      panel.style.height = getComputedStyle(panel).height;
      void panel.offsetHeight;
      panel.style.height = '0px';
    }
  }

  /* 叠图卡的交互。行为都收在这里，renderGallery 与 updateGalleryCard 共用，
     免得两条路径慢慢漂移。 */
  function bindStack(card, block) {
    if (!block) return;
    const toggle = () => setStackOpen(card, !card.classList.contains('is-open'));
    card.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]');
      if (!act || !card.contains(act)) return;
      if (act.dataset.act === 'collapse') {
        setStackOpen(card, false);
        /* 「收起」按钮马上就要消失，焦点得还回封面，别掉到 body 上 */
        const cover = card.querySelector('.stack-cover');
        if (cover) cover.focus();
        return;
      }
      toggle();
    });
    /* Escape 先收这张卡；不拦住的话会一路冒到全局处理器把灯箱一起关了 */
    card.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || !card.classList.contains('is-open')) return;
      e.stopPropagation();
      setStackOpen(card, false);
      const cover = card.querySelector('.stack-cover');
      if (cover) cover.focus();
    });
    $$('.stack-thumb', card).forEach((btn) => {
      btn.addEventListener('click', () => { openLightbox(Number(btn.dataset.index)).catch(() => {}); });
    });
    hydratePicImg(card);
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
      /* complete 就说明解码尝试已经结束（成功或失败都算）。
         不能只认 naturalWidth > 0 —— 破图也 complete，那样它会永远停在全透明。 */
      if (img.complete) { img.classList.add('is-loaded'); return; }
      const done = () => img.classList.add('is-loaded');
      img.addEventListener('load', done, { once: true });
      img.addEventListener('error', done, { once: true });
    });
  }

  function renderGallery() {
    const box = $('#galleryGrid');
    const sorted = state.gallery.slice().sort((a, b) => (a.order || 0) - (b.order || 0));
    /* 关键词与标签都在「块」这一级过筛：组里任何一张命中，整组就留下 */
    const shown = buildBlocks(sorted).filter((b) => {
      if (state.keyword && !b.members.some(matchKeyword)) return false;
      if (state.galleryTag !== 'all' &&
        !b.members.some((m) => (m.tags || []).indexOf(state.galleryTag) !== -1)) return false;
      return true;
    });

    /* 展平一遍：灯箱的上一张 / 下一张要能跨组走到组里的每一张 */
    const flat = [];
    const view = shown.map((b) => {
      const startIndex = flat.length;
      b.members.forEach((m) => flat.push(m));
      return { kind: b.kind, key: b.key, members: b.members, startIndex };
    });
    state.view.gallery = flat;
    state.view.blocks = view;

    $('#galleryEmpty').hidden = view.length > 0;
    box.innerHTML = view.map((b) => (b.kind === 'stack'
      ? stackHtml(b, b.startIndex)
      : picHtml(b.members[0], b.startIndex))).join('');

    $$('.pic', box).forEach((el) => {
      const key = el.dataset.stack;
      if (key) bindStack(el, view.filter((b) => b.key === key)[0]);
      else bindPic(el);
    });
    observeReveal(box);
    /* 整块重排之后，灯箱那排「同组缩略图」缓存的索引与成员都可能对不上了 */
    state.lbStripKey = null;
  }

  /* 只换掉那一块（单张卡 / 整张叠图卡）。解锁一张图之后走这里，而不是 renderGallery()：
     整块重建会把页面上所有卡片重新淡入一遍，用户看到的就是「全部小窗都会闪」。 */
  function updateGalleryCard(id) {
    const box = $('#galleryGrid');
    if (!box) return;
    const block = (state.view.blocks || []).filter((b) => b.members.some((m) => m.id === id))[0];
    if (!block) { renderGallery(); return; }   /* 没找到就退回整块重建，至少状态是对的 */
    const old = box.querySelector(block.kind === 'stack'
      ? '.pic-stack[data-id="' + block.members[0].id + '"]'
      : '.pic[data-id="' + id + '"]');
    if (!old) { renderGallery(); return; }

    /* 已经是对的状态就别再换节点 —— 换节点本身也是一次可见的重绘。
       解锁回调与点卡片两条路径都会走到这里，去重后只换一次。 */
    if (block.kind === 'one') {
      const img = old.querySelector('img');
      if (state.decUrls[id] && img && img.src.indexOf('blob:') === 0 &&
        !old.classList.contains('is-locked') && !old.classList.contains('is-decrypting')) {
        return;
      }
    } else {
      const shown = old.querySelector('.stack-thumb[data-id="' + id + '"] img');
      if (state.decUrls[id] && shown && shown.src.indexOf('blob:') === 0) return;
    }

    const wasOpen = old.classList.contains('is-open');
    /* 换节点前先记住焦点在哪儿：解锁一张图之后会重画整块卡片，
       原来那个按钮已经不在文档里了，焦点会掉回 <body> ——
       键盘用户刚刚点的地方直接丢失，等于要重新 Tab 一遍。 */
    const active = document.activeElement;
    const focusId = (active && old.contains(active) && active.dataset) ? (active.dataset.id || '') : '';
    const focusCover = Boolean(active && active.classList && active.classList.contains('stack-cover'));

    const holder = document.createElement('div');
    holder.innerHTML = block.kind === 'stack'
      ? stackHtml(block, block.startIndex)
      : picHtml(block.members[0], block.startIndex);
    const next = holder.firstElementChild;
    if (!next) return;
    next.style.setProperty('--d', old.style.getPropertyValue('--d') || '0ms');
    if (old.classList.contains('is-in')) next.classList.add('is-in');
    old.replaceWith(next);
    if (block.kind === 'stack') {
      bindStack(next, block);
      /* 原来就摊开着的话静默恢复展开态，否则会看到它自己先收一下再打开 */
      if (wasOpen) setStackOpen(next, true, true);
    } else {
      bindPic(next);
    }

    /* 按 id 把焦点还回去（不认节点：那个节点已经被换掉了） */
    if (focusId) {
      const back = next.querySelector('[data-id="' + focusId + '"]');
      if (back && back.focus) back.focus({ preventScroll: true });
    } else if (focusCover) {
      const cover = next.querySelector('.stack-cover');
      if (cover) cover.focus({ preventScroll: true });
    }

    /* 换进来的节点得重新挂上进场观察：
       原来那张卡可能还没滚进视口（没有 is-in），直接换节点会让它永远停在
       opacity:0 —— 表现成「这张卡凭空消失了」。 */
    observeReveal(box);
    /* 灯箱底部那排同组缩略图可能已经过期（比如组内某张刚解开），下次打开重画 */
    state.lbStripKey = null;
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
      /* 刚解锁的这张如果就在底部那排缩略图里，得让它换成明文 —— 丢掉缓存重画一遍 */
      state.lbStripKey = null;
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
    updateLbStrip(item);
  }

  /* 灯箱底部那排「同组缩略图」。
     展开一叠图之后点进任意一张，能在组内直接换来换去 —— 不然要退出来重新展开。
     只在组变化时重建 DOM，翻页只改高亮，免得缩略图每次翻页都重解码闪一下。 */
  function updateLbStrip(item) {
    const strip = $('#lbStrip');
    if (!strip) return;
    const block = (state.view.blocks || []).filter(
      (b) => b.kind === 'stack' && b.members.some((m) => m.id === item.id))[0];
    const figure = $('.lb-figure');
    if (!block) {
      strip.hidden = true;
      state.lbStripKey = null;
      if (figure) figure.classList.remove('has-strip');
      return;
    }
    strip.hidden = false;
    if (figure) figure.classList.add('has-strip');

    if (state.lbStripKey !== block.key) {
      const tagName = Vault() ? Vault().tag() : '加密';
      strip.innerHTML = block.members.map((m, i) => {
        const s = gallerySrc(m);
        const locked = isLocked(m) && !s;
        const name = m.title || (locked ? tagName : '第 ' + (i + 1) + ' 张');
        return '<button class="lb-strip-item' + (locked ? ' is-locked' : '') + '" type="button"' +
          ' data-lb-strip="' + (block.startIndex + i) + '" data-lb-id="' + esc(m.id) + '"' +
          ' aria-label="' + esc(name + (locked ? '，需要口令才能查看' : '')) + '">' +
          (s
            ? '<img src="' + esc(s) + '" alt="" loading="lazy">'
            : '<span class="lb-strip-lock">' + LOCK_ICON + '</span>') +
        '</button>';
      }).join('');
      $$('[data-lb-strip]', strip).forEach((btn) => {
        btn.addEventListener('click', () => { openLightbox(Number(btn.dataset.lbStrip)).catch(() => {}); });
      });
      state.lbStripKey = block.key;
    }
    $$('[data-lb-strip]', strip).forEach((btn) => {
      const on = btn.dataset.lbId === item.id;
      btn.classList.toggle('is-current', on);
      if (on) btn.setAttribute('aria-current', 'true');
      else btn.removeAttribute('aria-current');
    });
  }

  function closeLightbox() {
    $('#lightbox').hidden = true;
    document.body.style.overflow = '';
    /* 丢掉缩略图缓存：关灯箱期间可能有图被解锁，下次打开要按最新状态重画 */
    state.lbStripKey = null;
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
    /* 按 id 找，不按 index —— 叠图卡的根节点没有 data-index（索引分散在各张缩略图上），
       按 index 反查会让整张卡拿不到进度。解一张 5 MB 的图要好几秒，
       那几秒里用户看到的就是「点了没反应」。 */
    const tagName = Vault() ? Vault().tag() : '加密';
    $$('.pic', box).forEach((card) => {
      const coverId = card.dataset.id;
      if (!card.classList.contains('pic-stack')) {
        const busy = Boolean(state.decrypting[coverId]);
        card.classList.toggle('is-decrypting', busy);
        if (busy) card.setAttribute('aria-busy', 'true');
        else card.removeAttribute('aria-busy');
        const label = card.querySelector('.pic-lock span');
        if (label) {
          label.textContent = busy ? (state.decProgress[coverId] || '正在解密…') : '加密作品 · 点击解锁';
        }
        return;
      }
      /* 叠图卡：封面与组内每张缩略图各有各的进度，互不相干 */
      $$('.stack-thumb', card).forEach((btn) => {
        const id = btn.dataset.id;
        const busy = Boolean(state.decrypting[id]);
        btn.classList.toggle('is-decrypting', busy);
        if (busy) btn.setAttribute('aria-busy', 'true');
        else btn.removeAttribute('aria-busy');
        const em = btn.querySelector('.stack-thumb-lock em');
        if (em) em.textContent = busy ? (state.decProgress[id] || '解密中…') : tagName;
      });
      const coverBusy = Boolean(state.decrypting[coverId]);
      const coverLabel = card.querySelector('.stack-cover .pic-lock span');
      if (coverLabel) {
        coverLabel.textContent = coverBusy
          ? (state.decProgress[coverId] || '正在解密…')
          : (card.classList.contains('is-open') ? '加密作品 · 点击收起' : '加密作品 · 点击展开');
      }
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
