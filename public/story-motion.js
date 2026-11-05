// 首页演示：只在可见时播放；脚本只切换真实组件自身的状态（选中、按下、禁用、状态类），离开页面时全部释放。
const THEMES = ['王者荣耀', 'B站UP主', '欧美音乐'];
const ROUND_WORDS = [['海洋', '天空'], ['蓝色', '星空'], ['深海', '银河']];

function setSegment(group, index) {
  if (!group) return;
  group.style.setProperty('--selected', String(index));
  group.querySelectorAll('.segment').forEach((button, i) => {
    button.classList.toggle('selected', i === index);
    button.setAttribute('aria-pressed', String(i === index));
  });
}

function setStatus(item, key, text, glyph) {
  if (!item) return;
  for (const name of [...item.classList]) if (name.startsWith('status-')) item.classList.remove(name);
  item.classList.add(`status-${key}`);
  item.querySelector('.ready-state use')?.setAttribute('href', `/icons.svg#icon-${glyph}`);
  const label = item.querySelector('.ready-state > span');
  if (label) label.textContent = text;
}

function setDisabled(buttons, disabled) {
  for (const button of buttons) {
    if (disabled) button.setAttribute('disabled', '');
    else button.removeAttribute('disabled');
  }
}

// 每个演示是一串 [延迟, 动作]，循环执行；不可见时原地等待，不推进时间线。
const SCENES = {
  round(demo, press) {
    const typed = demo.querySelector('[data-demo-typed]');
    const submit = demo.querySelector('[data-demo-submit]');
    const votes = [...demo.querySelectorAll('[data-demo-vote]')];
    const panels = Object.fromEntries([...demo.querySelectorAll('[data-demo-panel]')].map((el) => [el.dataset.demoPanel, el]));
    const steps = [...demo.querySelectorAll('.stage-step')];
    const roundNo = demo.querySelector('[data-demo-round]');
    const cards = [...(panels.reveal?.querySelectorAll('.word-card strong') || [])];
    const toast = demo.querySelector('.toast');
    let round = 0;
    const show = (name) => { for (const [key, el] of Object.entries(panels)) el.classList.toggle('is-shown', key === name); };
    const step = (index) => steps.forEach((el, i) => el.classList.toggle('is-current', i === index));
    const words = () => ROUND_WORDS[round % ROUND_WORDS.length];
    const typing = () => [...words()[0]].map((_, i) => [170, () => { typed.textContent = words()[0].slice(0, i + 1); }]);
    return () => [
      [0, () => {
        if (roundNo) roundNo.textContent = String(round % ROUND_WORDS.length + 1);
        typed.textContent = '';
        submit.querySelector('span').textContent = '提交';
        setDisabled([submit, ...votes], false);
        step(0); show('write');
      }],
      [700, () => {}],
      ...typing(),
      [600, () => press(submit)],
      [180, () => { submit.querySelector('span').textContent = '已提交，等待其他玩家'; setDisabled([submit], true); }],
      [800, () => { cards.forEach((card, i) => { card.textContent = words()[i]; }); step(1); show('reveal'); }],
      [1300, () => press(votes[1])],
      [180, () => setDisabled(votes, true)],
      [500, () => { toast?.classList.add('visible'); step(2); }],
      [1500, () => { toast?.classList.remove('visible'); round += 1; }],
      [500, () => {}]
    ];
  },
  theme(demo) {
    const group = demo.querySelector('.segmented');
    const stage = demo.querySelector('.writing-stage');
    const name = demo.querySelector('.current-theme strong');
    let index = 0;
    return () => [
      [0, () => { setSegment(group, 1); if (name) name.textContent = THEMES[index++ % THEMES.length]; stage.classList.remove('demo-theme-off'); }],
      [2600, () => { setSegment(group, 0); stage.classList.add('demo-theme-off'); }],
      [2200, () => {}]
    ];
  },
  settings(demo) {
    const group = demo.querySelector('.segmented');
    const reels = [...demo.querySelectorAll('.demo-digit-reel')];
    const toggle = demo.querySelector('.switch');
    const values = [15, 30, 45, 60];
    let index = 2;
    const apply = () => {
      setSegment(group, index);
      String(values[index]).padStart(2, '0').split('').forEach((digit, i) => {
        if (reels[i]) reels[i].style.transform = `translateY(${-Number(digit) * 10}%)`;
      });
    };
    return () => [
      [1600, () => { index = (index + 1) % values.length; apply(); }],
      [1600, () => { index = (index + 1) % values.length; apply(); toggle?.setAttribute('aria-checked', String(toggle.getAttribute('aria-checked') !== 'true')); }]
    ];
  },
  reconnect(demo) {
    const item = demo.querySelectorAll('.player')[1];
    return () => [
      [0, () => { item.classList.remove('is-ready'); setStatus(item, 'away', '连接中断', 'log-out'); }],
      [1800, () => { item.classList.add('is-ready'); setStatus(item, 'done', '已准备', 'check'); }],
      [2600, () => {}]
    ];
  },
  break(demo, press) {
    const [mine, other] = demo.querySelectorAll('.game-status');
    const buttons = [...demo.querySelectorAll('.game-actions .button')];
    const yes = demo.querySelector('[data-action="break-yes"]');
    const hint = demo.querySelector('[data-demo-hint]');
    return () => [
      [0, () => {
        setStatus(mine, 'waiting', '未投票', 'clock'); setStatus(other, 'waiting', '未投票', 'clock');
        setDisabled(buttons, false);
        if (hint) hint.textContent = '选择提交后不可更改；结果确定后提前结束';
      }],
      [1400, () => press(yes)],
      [180, () => { setStatus(mine, 'done', '已投票', 'check'); setDisabled(buttons, true); if (hint) hint.textContent = '已选择，结果确定或倒计时结束后揭晓'; }],
      [1100, () => setStatus(other, 'done', '已投票', 'check')],
      [2200, () => {}]
    ];
  }
};

function runScene(demo, active, timers) {
  const press = (button) => {
    if (!button) return;
    button.classList.add('is-pressed');
    timers.add(setTimeout(() => button.classList.remove('is-pressed'), 160));
  };
  const build = SCENES[demo.dataset?.demo]?.(demo, press);
  if (!build) return;
  let queue = [];
  const next = () => {
    if (!queue.length) queue = build();
    const [delay, action] = queue[0];
    const timer = setTimeout(() => {
      timers.delete(timer);
      if (!active()) { timers.add(setTimeout(next, 400)); return; }
      queue.shift();
      action();
      next();
    }, delay);
    timers.add(timer);
  };
  next();
}

export function observeStoryMotion(root, { doc = document, Observer = globalThis.IntersectionObserver, matchMedia = globalThis.matchMedia } = {}) {
  const demos = [...root.querySelectorAll('[data-story-demo]')];
  if (!demos.length || !Observer) return () => {};
  for (const demo of demos) demo.classList.add('motion-observed');
  const observer = new Observer((entries) => {
    for (const entry of entries) entry.target.classList.toggle('motion-visible', entry.isIntersecting);
  });
  for (const demo of demos) observer.observe(demo);
  const updateVisibility = () => {
    for (const demo of demos) demo.classList.toggle('motion-hidden', doc.hidden);
  };
  updateVisibility();
  doc.addEventListener('visibilitychange', updateVisibility);
  // 减少动态效果时不驱动状态切换，演示停在静态的最终状态。
  const timers = new Set();
  if (!matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
    for (const demo of demos) {
      if (typeof demo.querySelector !== 'function') continue;
      runScene(demo, () => demo.classList.contains('motion-visible') && !doc.hidden, timers);
    }
  }
  return () => {
    observer.disconnect();
    doc.removeEventListener('visibilitychange', updateVisibility);
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
  };
}
