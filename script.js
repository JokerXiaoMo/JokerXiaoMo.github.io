const characters = {
  aurelia: { sigil: "月", kind: "核心角色 · 01", name: "Aurelia · 月弧主理人", quote: "“把夜色折进字句。”", copy: "她在月弧最亮的地方整理来信，让每一页叙事都找到归航的方向。", image: "assets/characters/aurelia.png" },
  lyra: { sigil: "星", kind: "核心角色 · 02", name: "Lyra · 书页观测者", quote: "“每一颗星，都有被读懂的时刻。”", copy: "她在无声书页之间记录光的走向，把遥远的夜写成近处的低语。", image: "assets/characters/lyra.webp" },
  noctis: { sigil: "夜", kind: "核心角色 · 03", name: "Noctis · 深夜执笔者", quote: "“夜色不是终点，是另一种开场。”", copy: "她把失眠的余温收进墨色，让每一次停顿都变成值得留存的句子。", image: "assets/characters/noctis.webp" },
  seraphine: { sigil: "羽", kind: "特别来访 · 天使", name: "Seraphine · 月羽天使", quote: "“羽翼也会在月光里学习安静。”", copy: "她守望那些尚未抵达的愿望，用柔软的光替花园留一盏灯。", image: "assets/characters/seraphine.webp" },
  velvet: { sigil: "薇", kind: "特别来访 · 小恶魔", name: "Velvet · 蔷薇小恶魔", quote: "“漂亮的冒险，总要带一点刺。”", copy: "她将蔷薇藏进晚风，也把最不驯服的笑意留给星光。", image: "assets/characters/velvet.webp" }
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
