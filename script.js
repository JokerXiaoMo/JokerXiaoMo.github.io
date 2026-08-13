const characters = {
  aurelia: { sigil: "灯", kind: "玄阙执灯人", name: "沈昭绫", quote: "“灯火不问来路，只照愿意前行的人。”", copy: "她守在玄阙最高的风口，以照夜金灯为迷途人留下一条可归的路。", image: "assets/characters/shen-zhaoling.png" },
  lyra: { sigil: "卷", kind: "青瓷司卷官", name: "陆青梧", quote: "“山河未必言语，落在纸上便有回音。”", copy: "她在青瓷司整理万卷山河，把沉默的地名写成可以抵达的回声。", image: "assets/characters/lyra.webp" },
  noctis: { sigil: "砚", kind: "墨渊执笔使", name: "顾砚秋", quote: "“墨色最深时，恰能写下最明亮的心事。”", copy: "她以玄墨长笔收住人间余温，让每一次停顿都成为山水的留白。", image: "assets/characters/noctis.webp" },
  seraphine: { sigil: "羽", kind: "九霄羽卫", name: "云栖梧", quote: "“风会替远行的人，将平安带回檐下。”", copy: "她守望云海尽头的归雁，以云羽铃为每位远行者报一声平安。", image: "assets/characters/seraphine.webp" },
  velvet: { sigil: "绫", kind: "赤绫巡使", name: "苏绯棠", quote: "“锋芒是护身的花刺，不是拒人千里的墙。”", copy: "她循朱砂绫印巡过长街与山隘，把最锋利的笑意留给不义之事。", image: "assets/characters/velvet.webp" }
};

document.querySelectorAll('.character-button').forEach(button => {
  button.addEventListener('click', () => {
    const character = characters[button.dataset.character];
    document.querySelectorAll('.character-button').forEach(item => { item.classList.remove('active'); item.setAttribute('aria-selected', 'false'); });
    button.classList.add('active'); button.setAttribute('aria-selected', 'true');
    document.querySelector('#profile-sigil').textContent = character.sigil;
    document.querySelector('#profile-kind').textContent = character.kind;
    document.querySelector('#profile-name').textContent = character.name;
    document.querySelector('#profile-quote').textContent = character.quote;
    document.querySelector('#profile-copy').textContent = character.copy;
    const portrait = document.querySelector('#profile-portrait');
    const image = document.querySelector('#profile-image');
    if (character.image) {
      image.src = character.image;
      image.alt = `${character.name} · ${character.name.split(' · ')[1]} 立绘`;
      portrait.hidden = false;
    } else {
      image.removeAttribute('src');
      image.alt = '';
      portrait.hidden = true;
    }
  });
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
