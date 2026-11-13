import { isInsaneMode } from './render.js';

export function countdownState(room, now) {
  const deadline = Number(room?.phaseDeadline);
  const seconds = Number.isFinite(deadline) && deadline > 0 ? Math.max(0, Math.ceil((deadline - now) / 1000)) : null;
  const grace = room?.phase === 'prepare' && Number(room.prepareGraceDeadline) > now;
  return { seconds, grace, urgent: !grace && seconds !== null && seconds <= 10 };
}

// 倾斜轨道：同一深度同时驱动透视大小、投影位置和前后遮挡。
export function planetPose(t, opposite = false, radiusPx = 1, diameter = radiusPx) {
  const progress = Math.min(1, Math.max(0, t));
  const approach = progress * progress * (3 - 2 * progress);
  const angle = -2.8 + Math.max(0, t) * Math.PI * 2 + (opposite ? Math.PI : 0);
  const depth = Math.sin(angle);
  const scale = .86 / (1 - .24 * depth);
  // 深度相等时位于轨道两端，保留足够间距，避免交叠中换层。
  const endRadius = Math.max(radiusPx * .45, diameter * .85);
  const radius = radiusPx + (endRadius - radiusPx) * approach;
  return { x: Math.cos(angle) * radius * scale, y: depth * radius * .35 * scale, scale, depth };
}
export function planetTransform(t, opposite = false, radiusPx = 1, diameter = radiusPx) {
  const { x, y, scale } = planetPose(t, opposite, radiusPx, diameter);
  return `translate(${x}px, ${y}px) scale(${scale})`;
}
const orbitProgress = new WeakMap();
function paintOrbits(orbits, progress, radius, diameter) {
  orbits.forEach((orbit, index) => {
    const pose = planetPose(progress, index === 1, radius, diameter);
    orbit.style.transform = planetTransform(progress, index === 1, radius, diameter);
    orbit.style.zIndex = pose.depth >= 0 ? '2' : '1';
  });
}
export function planetFrames(opposite = false, radiusPx = 1) {
  return Array.from({ length: 181 }, (_, index) => ({ offset: index / 180, transform: planetTransform(index / 180, opposite, radiusPx) }));
}
const orbitLoops = new WeakMap();
function syncOrbits(scene, elapsed) {
  const cosmos = scene.querySelector('.start-countdown-cosmos');
  if (!cosmos) return;
  let loop = orbitLoops.get(cosmos);
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  if (reduced.matches) {
    if (loop) cancelAnimationFrame(loop.frame);
    orbitLoops.delete(cosmos);
    for (const orbit of cosmos.querySelectorAll('.countdown-orbit')) { orbit.style.removeProperty('transform'); orbit.style.removeProperty('z-index'); }
    return;
  }
  const now = performance.now();
  if (loop) {
    if (Math.abs(now - loop.start - elapsed) > 300) loop.start = now - elapsed;
    return;
  }
  loop = { start: now - elapsed, frame: 0 };
  orbitLoops.set(cosmos, loop);
  const orbits = [...cosmos.querySelectorAll('.countdown-orbit')];
  const draw = (time) => {
    if (!cosmos.isConnected || reduced.matches) {
      for (const orbit of orbits) { orbit.style.removeProperty('transform'); orbit.style.removeProperty('z-index'); }
      orbitLoops.delete(cosmos);
      return;
    }
    const progress = Math.min(1, Math.max(0, (time - loop.start) / 5000));
    const radius = Math.min(window.innerWidth * .3, 320);
    const diameter = Math.min(300, Math.max(140, window.innerWidth * .24));
    orbitProgress.set(cosmos, { progress, radius, diameter });
    paintOrbits(orbits, progress, radius, diameter);
    if (progress < 1) loop.frame = requestAnimationFrame(draw);
    else orbitLoops.delete(cosmos);
  };
  draw(now);
}

// 五种狂意模式的倒计时主题色与像素元素动画。
export const INSANE_COUNTDOWN_THEMES = Object.freeze({
  livonym: {
    primary: '#8ee4d7',
    secondary: '#a0a9ff',
    accent: '#60dfaa',
    sprites: [
      // 光标/聊天气泡信号
      [
        '.#####.',
        '#.....#',
        '#.###.#',
        '#.....#',
        '.##.###',
        '.#.....'
      ],
      // 打字波形
      [
        '..#..#.',
        '.##.##.',
        '#######',
        '.##.##.',
        '..#..#.'
      ]
    ]
  },
  shiritori: {
    primary: '#b7a1ff',
    secondary: '#f3adcf',
    accent: '#f7e7ff',
    sprites: [
      // 链环首尾相接
      [
        '.###...',
        '#...#..',
        '#..###.',
        '.###..#',
        '..#...#',
        '...###.'
      ],
      // 接力箭头阶梯
      [
        '..#....',
        '.###...',
        '#####..',
        '..#..#.',
        '..#####'
      ]
    ]
  },
  impostor: {
    primary: '#f0a2b1',
    secondary: '#bd9cff',
    accent: '#ff5472',
    sprites: [
      // 窥视之眼
      [
        '..###..',
        '.#...#.',
        '#.#A#.#',
        '#.#A#.#',
        '.#...#.',
        '..###..'
      ],
      // 斜切划痕/裂隙
      [
        '....##',
        '...##.',
        '..##..',
        '.##...',
        '##....'
      ]
    ]
  },
  blitz: {
    primary: '#f9d483',
    secondary: '#ff9f8d',
    accent: '#ffd666',
    sprites: [
      // 闪电折角
      [
        '...###',
        '..##..',
        '.####.',
        '####..',
        '..##..',
        '.#....'
      ],
      // 速度线
      [
        '#####..',
        '.......',
        '..#####',
        '.......',
        '####...'
      ]
    ]
  },
  bridge: {
    primary: '#91cef1',
    secondary: '#c7a9ff',
    accent: '#e9e2ff',
    sprites: [
      // 拱桥跨岸
      [
        '..###..',
        '.#...#.',
        '#.....#',
        '#######',
        '#.....#'
      ],
      // 跨岸光点
      [
        '#.....#',
        '.#...#.',
        '..###..',
        '.#...#.',
        '#.....#'
      ]
    ]
  }
});

export function insaneCountdownTheme(mode) {
  return INSANE_COUNTDOWN_THEMES[mode] || INSANE_COUNTDOWN_THEMES.livonym;
}

const pixelLoops = new WeakMap();

function makeNodes(mode, width, height) {
  const radiusX = Math.min(width * 0.34, 340);
  const radiusY = Math.min(height * 0.28, 220);
  const count = width < 520 ? 10 : 14;
  const nodes = [];
  for (let i = 0; i < count; i++) {
    const baseAngle = (i / count) * Math.PI * 2;
    const ring = i % 2 === 0 ? 0.85 : 1.12;
    nodes.push({
      index: i,
      baseAngle,
      ring,
      rx: radiusX * ring,
      ry: radiusY * ring,
      spriteIndex: i % 2,
      pixelSize: i % 3 === 0 ? 5 : 4,
      phase: (i * 1.37) % (Math.PI * 2),
      kind: mode
    });
  }
  return nodes;
}

function drawSprite(ctx, sprite, cx, cy, pixelSize, palette, alpha, highlight = false) {
  const rows = sprite.length;
  const cols = sprite[0].length;
  const ox = Math.round(cx - (cols * pixelSize) / 2);
  const oy = Math.round(cy - (rows * pixelSize) / 2);
  ctx.save();
  ctx.globalAlpha = alpha;
  for (let r = 0; r < rows; r++) {
    const row = sprite[r];
    for (let c = 0; c < cols; c++) {
      const ch = row[c];
      if (ch === '.') continue;
      ctx.fillStyle = ch === 'A'
        ? palette.accent
        : highlight
          ? palette.accent
          : (r + c) % 2 === 0 ? palette.primary : palette.secondary;
      ctx.fillRect(ox + c * pixelSize, oy + r * pixelSize, pixelSize, pixelSize);
    }
  }
  ctx.restore();
}

export function insanePixelPose(node, t, mode, width, height) {
  const cx = width / 2;
  const cy = height * 0.45;
  const progress = Math.min(1, Math.max(0, t));
  if (mode === 'blitz') {
    // 极速闪电：左右两侧高速掠过与脉冲冲击
    const side = node.index % 2 === 0 ? -1 : 1;
    const lane = ((node.index * 0.37 + progress * 2.4) % 1);
    const x = cx + side * (110 + (1 - lane) * Math.min(width * 0.36, 360));
    const y = cy + Math.sin(node.phase * 2) * Math.min(height * 0.28, 200);
    return { x, y, alpha: 0.25 + 0.65 * Math.sin(lane * Math.PI), highlight: lane > 0.72 };
  }
  if (mode === 'shiritori') {
    // 接龙：成环步进跃迁
    const stepT = Math.floor(progress * 15) / 15;
    const angle = node.baseAngle + stepT * Math.PI * 0.9;
    const hop = Math.abs(Math.sin(progress * Math.PI * 10 + node.phase)) * 10;
    return {
      x: cx + Math.cos(angle) * node.rx,
      y: cy + Math.sin(angle) * node.ry - hop,
      alpha: 0.38 + 0.4 * ((Math.floor(progress * 5) + node.index) % 3 === 0 ? 1 : 0.4),
      highlight: (Math.floor(progress * 10) % 4) === (node.index % 4)
    };
  }
  if (mode === 'impostor') {
    // 思维卧底：潜伏呼吸，偶发错位闪烁
    const angle = node.baseAngle + progress * 0.45;
    const step = Math.floor(progress * 12);
    const jitter = (step + node.index) % 7 === 0 ? (node.index % 2 === 0 ? 8 : -8) : 0;
    return {
      x: cx + Math.cos(angle) * node.rx + jitter,
      y: cy + Math.sin(angle) * node.ry,
      alpha: (step + node.index) % 5 === 0 ? 0.78 : 0.32,
      highlight: (step + node.index) % 7 === 0
    };
  }
  if (mode === 'bridge') {
    // 语义搭桥：从左右两侧向中心弧线聚拢搭桥
    const side = node.index % 2 === 0 ? -1 : 1;
    const arc = Math.sin(progress * Math.PI);
    const span = Math.min(width * 0.34, 320) * (1 - 0.35 * progress);
    const x = cx + side * span * (0.45 + 0.55 * ((node.index % 3) / 2));
    const y = cy + (node.index - 6) * 22 - arc * 26;
    return {
      x,
      y,
      alpha: 0.35 + 0.45 * arc,
      highlight: node.index % 3 === 0
    };
  }
  // livonym：逐拍脉冲打字节拍亮起
  const beat = Math.floor(progress * 16);
  const lit = (node.index % 5) === (beat % 5);
  const angle = node.baseAngle + progress * Math.PI * 0.5;
  return {
    x: cx + Math.cos(angle) * node.rx,
    y: cy + Math.sin(angle) * node.ry - (lit ? 6 : 0),
    alpha: lit ? 0.85 : 0.32,
    highlight: lit
  };
}

function paintInsanePixels(canvas, mode, progress) {
  const ctx = canvas.getContext?.('2d');
  if (!ctx) return;
  const width = canvas.clientWidth || window.innerWidth || 800;
  const height = canvas.clientHeight || window.innerHeight || 600;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const targetW = Math.max(1, Math.round(width * dpr));
  const targetH = Math.max(1, Math.round(height * dpr));
  if (canvas.width !== targetW || canvas.height !== targetH) {
    canvas.width = targetW;
    canvas.height = targetH;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, width, height);

  const theme = insaneCountdownTheme(mode);
  const nodes = makeNodes(mode, width, height);
  // 画中心周围像素微粒，避开正中央数字区域
  const safeRx = Math.min(width * 0.22, 170);
  const safeRy = Math.min(height * 0.20, 145);
  const cx = width / 2;
  const cy = height * 0.46;

  for (const node of nodes) {
    const pose = insanePixelPose(node, progress, mode, width, height);
    // 确保像素精灵不遮挡中央倒计时文本
    const dx = (pose.x - cx) / safeRx;
    const dy = (pose.y - cy) / safeRy;
    const dist = Math.hypot(dx, dy);
    const push = dist < 1.05 && dist > 0 ? 1.08 / dist : 1;
    const px = cx + (pose.x - cx) * push;
    const py = cy + (pose.y - cy) * push;
    drawSprite(ctx, theme.sprites[node.spriteIndex], px, py, node.pixelSize, theme, pose.alpha, pose.highlight);
  }

  // 补充细碎像素方块点缀
  const dotCount = 12;
  for (let i = 0; i < dotCount; i++) {
    const a = (i / dotCount) * Math.PI * 2 + progress * (mode === 'blitz' ? 3.2 : 1.1);
    const r = 1.15 + 0.35 * Math.sin(progress * Math.PI * 4 + i);
    const x = Math.round(cx + Math.cos(a) * safeRx * r);
    const y = Math.round(cy + Math.sin(a) * safeRy * r);
    const step = (Math.floor(progress * 10) + i) % 3;
    ctx.save();
    ctx.globalAlpha = step === 0 ? 0.72 : 0.28;
    ctx.fillStyle = i % 2 === 0 ? theme.primary : theme.secondary;
    const size = step === 0 ? 6 : 4;
    ctx.fillRect(x, y, size, size);
    ctx.restore();
  }
}

function syncInsanePixels(scene, elapsed) {
  const container = scene.querySelector('.start-countdown-insane-fx');
  if (!container) return;
  const canvas = container.querySelector?.('.countdown-insane-canvas');
  if (!canvas) return;
  const mode = scene.dataset?.mode || '';
  if (!isInsaneMode(mode)) return;
  let loop = pixelLoops.get(container);
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  if (reduced.matches) {
    if (loop) cancelAnimationFrame(loop.frame);
    pixelLoops.delete(container);
    paintInsanePixels(canvas, mode, 0.2);
    return;
  }
  const now = performance.now();
  if (loop) {
    if (Math.abs(now - loop.start - elapsed) > 300) loop.start = now - elapsed;
    return;
  }
  loop = { start: now - elapsed, frame: 0 };
  pixelLoops.set(container, loop);
  const draw = (time) => {
    if (!container.isConnected || reduced.matches) {
      pixelLoops.delete(container);
      return;
    }
    const progress = Math.min(1, Math.max(0, (time - loop.start) / 5000));
    paintInsanePixels(canvas, mode, progress);
    if (progress < 1) loop.frame = requestAnimationFrame(draw);
    else pixelLoops.delete(container);
  };
  draw(now);
}

export function updateStartCountdown(element, seconds, remainingMs = seconds === null ? 5000 : seconds * 1000) {
  const scene = element.closest('.start-countdown');
  if (!scene) return;
  const elapsed = Math.min(5000, Math.max(0, 5000 - remainingMs));
  syncOrbits(scene, elapsed);
  syncInsanePixels(scene, elapsed);
  const beat = seconds === null ? 5 : Math.min(5, Math.max(0, seconds));
  const text = seconds === null ? '–' : beat === 0 ? '开始' : String(beat);
  if (element.textContent !== text) element.textContent = text;
  if (scene.dataset.beat === String(beat) && scene.dataset.synced) return;
  scene.dataset.beat = String(beat);
  scene.dataset.synced = 'true';
  scene.style.setProperty('--countdown-progress', String((5 - beat) / 5));
  for (const step of scene.querySelectorAll('[data-step]')) {
    step.classList.toggle('is-complete', Number(step.dataset.step) > beat);
  }
}

let launchCurtain;
export function clearLaunchCurtain() {
  launchCurtain?.remove();
  launchCurtain = null;
}

// 先保留旧画面，再从中心挖开圆形窗口；独立遮罩避免与页面过渡争抢时序。
export function showLaunchCurtain() {
  clearLaunchCurtain();
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || document.hidden) return;
  const source = document.querySelector('.start-countdown');
  if (!source) return;
  const curtain = document.createElement('div');
  curtain.className = 'countdown-launch-curtain';
  curtain.setAttribute('aria-hidden', 'true');
  curtain.inert = true;
  const radius = Math.hypot(window.innerWidth / 2, window.innerHeight * .54) + 2;
  curtain.style.setProperty('--reveal-end', `${radius}px`);
  for (const pseudo of ['::before', '::after']) {
    const style = getComputedStyle(document.body, pseudo);
    const layer = document.createElement('div');
    layer.className = 'launch-atmosphere';
    for (const property of ['background', 'filter', 'opacity', 'transform']) layer.style[property] = style[property];
    curtain.append(layer);
  }
  const continuation = orbitProgress.get(source.querySelector('.start-countdown-cosmos'));
  for (const original of [source, document.querySelector('.site-footer')].filter(Boolean)) {
    const clone = original.cloneNode(true);
    const rect = original.getBoundingClientRect();
    const originals = [original, ...original.querySelectorAll('*')];
    const copies = [clone, ...clone.querySelectorAll('*')];
    copies.forEach((copy, index) => {
      const style = getComputedStyle(originals[index]);
      copy.removeAttribute('id');
      copy.style.animation = 'none';
      copy.style.transition = 'none';
      copy.style.transform = style.transform;
      copy.style.opacity = style.opacity;
      copy.style.zIndex = style.zIndex;
      copy.style.color = style.color;
    });
    Object.assign(clone.style, { position: 'absolute', left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px`, margin: '0' });
    curtain.append(clone);
  }
  document.body.append(curtain);
  launchCurtain = curtain;
  const movingOrbits = [...curtain.querySelectorAll('.countdown-orbit')];
  const started = performance.now();
  const continueOrbits = (now) => {
    if (!curtain.isConnected || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (continuation) {
      const { progress, radius, diameter } = continuation;
      paintOrbits(movingOrbits, progress + (now - started) / 5000, radius, diameter);
    }
    requestAnimationFrame(continueOrbits);
  };
  requestAnimationFrame(continueOrbits);
  const cleanup = () => {
    curtain.remove();
    if (launchCurtain === curtain) launchCurtain = null;
  };
  curtain.addEventListener('animationend', (event) => { if (event.target === curtain) cleanup(); });
  setTimeout(cleanup, 1300);
}

export function fadeFirstRound(page) {
  if (!page || window.matchMedia('(prefers-reduced-motion: reduce)').matches || document.hidden) return;
  page.animate([{ opacity: 0 }, { opacity: 1 }], {
    duration: 900, easing: 'cubic-bezier(.65, 0, .35, 1)'
  });
}
