const characters = {
  aurelia: { sigil: "灯", kind: "玄阙执灯人", name: "沈昭绫", temperament: "沉静笃定，愿以微光守住归途。", relic: "照夜金灯", quote: "“灯火不问来路，只照愿意前行的人。”", copy: "她守在玄阙最高的风口，以照夜金灯为迷途人留下一条可归的路。", image: "assets/characters/shen-zhaoling-v2.png" },
  lyra: { sigil: "卷", kind: "青瓷司卷官", name: "陆青梧", temperament: "温和缜密，最擅听见沉默的回音。", relic: "青瓷卷轴", quote: "“山河未必言语，落在纸上便有回音。”", copy: "她在青瓷司整理万卷山河，把沉默的地名写成可以抵达的回声。", image: "assets/characters/lu-qingwu-v6.png" },
  noctis: { sigil: "砚", kind: "墨渊执笔使", name: "顾砚秋", temperament: "寡言锐利，将未竟心事藏进留白。", relic: "玄墨长笔", quote: "“墨色最深时，恰能写下最明亮的心事。”", copy: "她以玄墨长笔收住人间余温，让每一次停顿都成为山水的留白。", image: "assets/characters/gu-yanqiu-v6.png" },
  seraphine: { sigil: "羽", kind: "九霄羽卫", name: "云栖梧", temperament: "温柔果决，守望每一位远行者。", relic: "云羽铃", quote: "“风会替远行的人，将平安带回檐下。”", copy: "她守望云海尽头的归雁，以云羽铃为每位远行者报一声平安。", image: "assets/characters/yun-qiwu-v6.png" },
  velvet: { sigil: "绫", kind: "赤绫巡使", name: "苏绯棠", temperament: "明艳不驯，却把软肋藏得很深。", relic: "朱砂绫印", quote: "“锋芒是护身的花刺，不是拒人千里的墙。”", copy: "她循朱砂绫印巡过长街与山隘，把最锋利的笑意留给不义之事。", image: "assets/characters/su-feitang-v2.png" }
};
let selectedCharacter = characters.aurelia;
const profilePortraitOpen = document.querySelector('#open-character-portrait-modal');

document.querySelectorAll('.character-button').forEach(button => {
  button.addEventListener('click', () => {
    const character = characters[button.dataset.character];
    selectedCharacter = character;
    document.querySelectorAll('.character-button').forEach(item => { item.classList.remove('active'); item.setAttribute('aria-selected', 'false'); });
    button.classList.add('active'); button.setAttribute('aria-selected', 'true');
    document.querySelector('#profile-sigil').textContent = character.sigil;
    document.querySelector('#profile-kind').textContent = character.kind;
    document.querySelector('#profile-name').textContent = character.name;
    document.querySelector('#profile-quote').textContent = character.quote;
    document.querySelector('#profile-copy').textContent = character.copy;
    document.querySelector('#profile-temperament').textContent = `性情：${character.temperament}`;
    document.querySelector('#profile-relic').textContent = `信物 · ${character.relic}`;
    const portrait = document.querySelector('#profile-portrait');
    const image = document.querySelector('#profile-image');
    if (character.image) {
      image.src = character.image;
      image.alt = `${character.name} · ${character.name.split(' · ')[1]} 立绘`;
      image.setAttribute('draggable', 'false');
      portrait.hidden = false;
    } else {
      image.removeAttribute('src');
      image.alt = '';
      portrait.hidden = true;
    }
    profilePortraitOpen.textContent = `查看 ${character.name} 立绘`;
    profilePortraitOpen.setAttribute('aria-label', `查看${character.name}立绘`);
  });
});

const shanhaiModal = document.querySelector('#shanhai-modal');
const shanhaiOpen = document.querySelector('#open-shanhai-modal');
const shanhaiClose = document.querySelector('#close-shanhai-modal');

const closeShanhaiModal = () => {
  shanhaiModal.hidden = true;
  document.body.classList.remove('shanhai-modal-open');
  shanhaiOpen.focus();
};

shanhaiOpen.addEventListener('click', () => {
  shanhaiModal.hidden = false;
  document.body.classList.add('shanhai-modal-open');
  shanhaiClose.focus();
});

shanhaiClose.addEventListener('click', closeShanhaiModal);
shanhaiModal.addEventListener('click', event => {
  if (event.target === shanhaiModal) closeShanhaiModal();
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !shanhaiModal.hidden) closeShanhaiModal();
});

const characterPortraitModal = document.querySelector('#character-portrait-modal');
const characterPortraitClose = document.querySelector('#close-character-portrait-modal');
const characterPortraitTitle = document.querySelector('#character-portrait-modal-title');
const characterPortraitImage = document.querySelector('#character-portrait-modal-image');

const closeCharacterPortraitModal = () => {
  characterPortraitModal.hidden = true;
  document.body.classList.remove('shanhai-modal-open');
  profilePortraitOpen.focus();
};

profilePortraitOpen.addEventListener('click', () => {
  characterPortraitTitle.textContent = `${selectedCharacter.name} · ${selectedCharacter.kind}`;
  characterPortraitImage.src = selectedCharacter.image;
  characterPortraitImage.alt = `${selectedCharacter.name}的古风动漫立绘`;
  characterPortraitModal.hidden = false;
  document.body.classList.add('shanhai-modal-open');
  characterPortraitClose.focus();
});

characterPortraitClose.addEventListener('click', closeCharacterPortraitModal);
characterPortraitModal.addEventListener('click', event => {
  if (event.target === characterPortraitModal) closeCharacterPortraitModal();
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !characterPortraitModal.hidden) closeCharacterPortraitModal();
});

const isProtectedPortrait = target => target instanceof Element && Boolean(target.closest('.copyright-portrait'));
document.addEventListener('contextmenu', event => {
  if (!isProtectedPortrait(event.target)) return;
  event.preventDefault();
});
document.addEventListener('dragstart', event => {
  if (!isProtectedPortrait(event.target)) return;
  event.preventDefault();
});
document.addEventListener('selectstart', event => {
  if (!isProtectedPortrait(event.target)) return;
  event.preventDefault();
});

const articleSection = document.querySelector('#articles');
const articleGrid = document.querySelector('#article-grid');
const articleModal = document.querySelector('#article-modal');
const articleModalTitle = document.querySelector('#article-modal-title');
const articleModalMeta = document.querySelector('#article-modal-meta');
const articleModalBody = document.querySelector('#article-modal-body');
const articleModalClose = document.querySelector('#close-article-modal');
const staticArticles = Array.isArray(window.TAOBEI_ARTICLES) ? window.TAOBEI_ARTICLES : [];
let lastArticleTrigger;

const closeArticleModal = () => {
  articleModal.hidden = true;
  document.body.classList.remove('shanhai-modal-open');
  lastArticleTrigger?.focus();
};

const openArticleModal = (article, trigger) => {
  lastArticleTrigger = trigger;
  articleModalTitle.textContent = article.title;
  articleModalMeta.textContent = `${article.date} · ${article.category}`;
  articleModalBody.replaceChildren(...article.paragraphs.map(paragraph => {
    const node = document.createElement('p');
    node.textContent = paragraph;
    return node;
  }));
  articleModal.hidden = false;
  document.body.classList.add('shanhai-modal-open');
  articleModalClose.focus();
};

if (staticArticles.length) {
  articleSection.hidden = false;
  staticArticles.forEach(article => {
    if (!article || !article.id || !article.title || !Array.isArray(article.paragraphs)) return;
    const card = document.createElement('article');
    card.className = 'article-card reveal';
    const meta = document.createElement('p');
    meta.className = 'article-card__meta';
    meta.innerHTML = `<span></span><span></span>`;
    meta.children[0].textContent = article.date || '书庭新卷';
    meta.children[1].textContent = article.category || '书庭新卷';
    const title = document.createElement('h3');
    title.textContent = article.title;
    const summary = document.createElement('p');
    summary.textContent = article.summary || article.paragraphs[0] || '';
    const openButton = document.createElement('button');
    openButton.className = 'article-card__open';
    openButton.type = 'button';
    openButton.textContent = '展开文字长卷';
    openButton.setAttribute('aria-label', `展开文章：${article.title}`);
    openButton.addEventListener('click', () => openArticleModal(article, openButton));
    card.append(meta, title, summary, openButton);
    articleGrid.append(card);
  });
}

articleModalClose.addEventListener('click', closeArticleModal);
articleModal.addEventListener('click', event => {
  if (event.target === articleModal) closeArticleModal();
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !articleModal.hidden) closeArticleModal();
});

const field = document.querySelector('#petal-field');
for (let index = 0; index < 24; index += 1) {
  const petal = document.createElement('i');
  petal.className = 'petal';
  petal.style.left = `${Math.random() * 100}%`;
  petal.style.setProperty('--fall', `${11 + Math.random() * 13}s`);
  petal.style.setProperty('--delay', `${-Math.random() * 18}s`);
  petal.style.setProperty('--sway', `${-110 + Math.random() * 220}px`);
  field.appendChild(petal);
}
