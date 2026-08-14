const characters = {
  aurelia: { sigil: "灯", kind: "玄阙执灯人", name: "沈昭绫", temperament: "沉静笃定，愿以微光守住归途。", relic: "照夜金灯", quote: "“灯火不问来路，只照愿意前行的人。”", copy: "她守在玄阙最高的风口，以照夜金灯为迷途人留下一条可归的路。", image: "assets/characters/shen-zhaoling-v2.png" },
  lyra: { sigil: "卷", kind: "青瓷司卷官", name: "陆青梧", temperament: "温和缜密，最擅听见沉默的回音。", relic: "青瓷卷轴", quote: "“山河未必言语，落在纸上便有回音。”", copy: "她在青瓷司整理万卷山河，把沉默的地名写成可以抵达的回声。", image: "assets/characters/lu-qingwu-v2.png" },
  noctis: { sigil: "砚", kind: "墨渊执笔使", name: "顾砚秋", temperament: "寡言锐利，将未竟心事藏进留白。", relic: "玄墨长笔", quote: "“墨色最深时，恰能写下最明亮的心事。”", copy: "她以玄墨长笔收住人间余温，让每一次停顿都成为山水的留白。", image: "assets/characters/gu-yanqiu-v2.png" },
  seraphine: { sigil: "羽", kind: "九霄羽卫", name: "云栖梧", temperament: "温柔果决，守望每一位远行者。", relic: "云羽铃", quote: "“风会替远行的人，将平安带回檐下。”", copy: "她守望云海尽头的归雁，以云羽铃为每位远行者报一声平安。", image: "assets/characters/yun-qiwu-v2.png" },
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
    profilePortraitOpen.textContent = `查看 ${character.name} 立绘 ↗`;
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

const taozhiVoidModal = document.querySelector('#taozhi-void-modal');
const taozhiVoidOpen = document.querySelector('#open-taozhi-void-modal');
const taozhiVoidClose = document.querySelector('#close-taozhi-void-modal');
const taozhiVoidDismiss = document.querySelector('#dismiss-taozhi-void-modal');
const taozhiReturnCountdown = document.querySelector('#taozhi-return-countdown');
const taozhiReturnTarget = document.querySelector('#taozhi-return-target');
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const taozhiReturnAt = new Date();
taozhiReturnAt.setFullYear(taozhiReturnAt.getFullYear() + 1);
let taozhiCountdownTimer;

const formatTaozhiCountdown = remainingMs => {
  const totalSeconds = Math.max(0, Math.floor(remainingMs / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${days} 日 ${String(hours).padStart(2, '0')} 时 ${String(minutes).padStart(2, '0')} 分 ${String(seconds).padStart(2, '0')} 秒`;
};

const updateTaozhiCountdown = () => {
  const remainingMs = taozhiReturnAt.getTime() - Date.now();
  taozhiReturnCountdown.textContent = remainingMs > 0 ? formatTaozhiCountdown(remainingMs) : '云梯正在回归';
  taozhiReturnCountdown.dateTime = taozhiReturnAt.toISOString();
};

const startTaozhiCountdown = () => {
  updateTaozhiCountdown();
  if (!prefersReducedMotion.matches && !taozhiCountdownTimer) {
    taozhiCountdownTimer = window.setInterval(updateTaozhiCountdown, 1000);
  }
};

const stopTaozhiCountdown = () => {
  if (taozhiCountdownTimer) window.clearInterval(taozhiCountdownTimer);
  taozhiCountdownTimer = undefined;
};

const formattedTaozhiReturnAt = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit'
}).format(taozhiReturnAt);
taozhiReturnTarget.textContent = `回归时刻 · ${formattedTaozhiReturnAt}`;

const closeTaozhiVoidModal = () => {
  stopTaozhiCountdown();
  taozhiVoidModal.classList.remove('is-open');
  taozhiVoidModal.hidden = true;
  document.body.classList.remove('shanhai-modal-open');
  taozhiVoidOpen.focus();
};

taozhiVoidOpen.addEventListener('click', () => {
  taozhiVoidModal.hidden = false;
  document.body.classList.add('shanhai-modal-open');
  window.requestAnimationFrame(() => taozhiVoidModal.classList.add('is-open'));
  startTaozhiCountdown();
  taozhiVoidClose.focus();
});

taozhiVoidClose.addEventListener('click', closeTaozhiVoidModal);
taozhiVoidDismiss.addEventListener('click', closeTaozhiVoidModal);
taozhiVoidModal.addEventListener('click', event => {
  if (event.target === taozhiVoidModal) closeTaozhiVoidModal();
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !taozhiVoidModal.hidden) closeTaozhiVoidModal();
});
prefersReducedMotion.addEventListener('change', event => {
  if (event.matches) stopTaozhiCountdown();
  else if (!taozhiVoidModal.hidden) startTaozhiCountdown();
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
