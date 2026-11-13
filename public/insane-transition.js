import { isInsaneMode, wordmarkArt } from './render.js';

export const PIXEL_CELL = 24;

// 与 insane.js 卡片顺序一致的默认像素波方向：奇数项自左向右，偶数项自右向左。
export const INSANE_WAVE_DIRECTION = Object.freeze({
  blitz: 'ltr',
  livonym: 'rtl',
  shiritori: 'ltr',
  impostor: 'rtl',
  bridge: 'ltr'
});

function hash2d(x, y) {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return n - Math.floor(n);
}

// 依据玩法卡片在列表中的方向判定像素波行进方向；找不到样式时按默认映射或索引回退。
export function pixelWaveDirectionForCard(card, mode = '') {
  if (card) {
    if (typeof getComputedStyle === 'function') {
      const dir = getComputedStyle(card, '::before').animationDirection;
      if (dir === 'reverse') return 'rtl';
      if (dir === 'normal') return 'ltr';
    }
    const parent = card.parentElement;
    if (parent) {
      const index = [...parent.children].indexOf(card);
      if (index >= 0) return index % 2 === 1 ? 'rtl' : 'ltr';
    }
  }
  return INSANE_WAVE_DIRECTION[mode] || 'rtl';
}

// 生成带有像素化弧形波前与同向弧形波尾的 SVG 蒙版，单元对齐 24px 方格。
export function buildPixelWaveMask({ width, height, cell = PIXEL_CELL, direction = 'rtl' } = {}) {
  const vw = Math.max(320, Math.round(width || 1280));
  const vh = Math.max(320, Math.round(height || 720));
  const rows = Math.max(1, Math.ceil(vh / cell));
  const edgeCols = 14;
  const solidCols = Math.ceil(vw / cell) + 6;
  const totalCols = edgeCols + solidCols + edgeCols;
  const maskWidth = totalCols * cell;
  const maskHeight = rows * cell;
  const tile = cell - 4;
  const rtl = direction !== 'ltr';
  const rects = [];

  // 主体实心覆膜：左右各吃进 3 列过渡区，保证全覆盖阶段零缝隙。
  const solidStartCol = edgeCols - 2;
  const solidEndCol = edgeCols + solidCols + 2;
  rects.push(`<rect x="${solidStartCol * cell}" y="0" width="${(solidEndCol - solidStartCol) * cell}" height="${maskHeight}" fill="#fff"/>`);

  for (let r = 0; r < rows; r += 1) {
    const ny = rows > 1 ? ((r + 0.5) / rows) * 2 - 1 : 0;
    const curve = (1 - ny * ny) * 4.5;
    const y = r * cell;

    // 左缘：rtl 时为向左侧突出的弧形波前；ltr 时为向右侧弧形收起的波尾。
    const frontMainCol = Math.round(rtl ? 9 - curve : 5 + curve);
    if (frontMainCol < solidStartCol) {
      rects.push(`<rect x="${frontMainCol * cell}" y="${y}" width="${(solidStartCol - frontMainCol) * cell}" height="${cell}" fill="#fff"/>`);
    }
    for (let c = 0; c < frontMainCol; c += 1) {
      const dist = frontMainCol - c;
      const density = dist === 1 ? 0.72 : dist === 2 ? 0.45 : dist <= 4 ? 0.22 : 0.08;
      if (dist <= 5 && hash2d(c + 1, r + 3) < density) {
        rects.push(`<rect x="${c * cell}" y="${y}" width="${tile}" height="${tile}" fill="#fff"/>`);
      }
    }

    // 右缘：rtl 时为向左侧弧形收起的波尾；ltr 时为向右侧突出的弧形波前。
    const backBase = edgeCols + solidCols;
    const backMainCol = backBase + Math.round(rtl ? 9 - curve : 5 + curve);
    if (backMainCol > solidEndCol) {
      rects.push(`<rect x="${solidEndCol * cell}" y="${y}" width="${(backMainCol - solidEndCol) * cell}" height="${cell}" fill="#fff"/>`);
    }
    for (let c = backMainCol; c < totalCols; c += 1) {
      const dist = c - backMainCol + 1;
      const density = dist === 1 ? 0.72 : dist === 2 ? 0.45 : dist <= 4 ? 0.22 : 0.08;
      if (dist <= 5 && hash2d(c + 31, r + 17) < density) {
        rects.push(`<rect x="${c * cell}" y="${y}" width="${tile}" height="${tile}" fill="#fff"/>`);
      }
    }
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${maskWidth}" height="${maskHeight}" viewBox="0 0 ${maskWidth} ${maskHeight}" shape-rendering="crispEdges">${rects.join('')}</svg>`;
  return {
    dataUri: `url("data:image/svg+xml,${encodeURIComponent(svg)}")`,
    maskWidth,
    maskHeight,
    edgeWidth: edgeCols * cell,
    solidWidth: solidCols * cell
  };
}

export function createInsaneTransitionController({
  onReveal,
  onDone,
  mount = () => document.body
} = {}) {
  const SWEEP_IN_MS = 520;
  const HOLD_MIN_MS = 320;
  const SWEEP_OUT_MS = 520;
  const WAIT_TIMEOUT_MS = 8000;

  let phase = 'idle'; // idle | sweeping-in | holding | waiting | sweeping-out
  let activeMode = '';
  let element = null;
  let sheet = null;
  let waves = null;
  let maskMetrics = null;
  let direction = 'rtl';
  let frame = 0;
  let holdTimer = 0;
  let waitTimer = 0;
  let roomReady = false;
  let revealed = false;

  function stepCoord(raw) {
    return Math.floor(raw / PIXEL_CELL) * PIXEL_CELL;
  }

  function applyPosition(rawX) {
    if (!sheet || !maskMetrics) return;
    const x = stepCoord(rawX);
    const pos = `${x}px 0px`;
    sheet.style.maskPosition = pos;
    sheet.style.webkitMaskPosition = pos;
    if (waves) {
      waves.style.transform = `translate3d(${x}px, 0, 0)`;
    }
  }

  function cleanup() {
    cancelAnimationFrame(frame);
    frame = 0;
    clearTimeout(holdTimer);
    holdTimer = 0;
    clearTimeout(waitTimer);
    waitTimer = 0;
    element?.remove();
    element = null;
    sheet = null;
    waves = null;
    maskMetrics = null;
    activeMode = '';
    phase = 'idle';
    roomReady = false;
    revealed = false;
  }

  function finish() {
    cleanup();
    onDone?.();
  }

  function startSweepOut() {
    if (!sheet || !maskMetrics) { finish(); return; }
    phase = 'sweeping-out';
    const vw = Math.max(320, window.innerWidth);
    const startX = direction === 'rtl'
      ? -(maskMetrics.edgeWidth + PIXEL_CELL * 2)
      : -(maskMetrics.maskWidth - vw - maskMetrics.edgeWidth - PIXEL_CELL * 2);
    const endX = direction === 'rtl'
      ? -(maskMetrics.maskWidth + PIXEL_CELL)
      : vw + PIXEL_CELL;
    const started = performance.now();

    const tick = (now) => {
      if (phase !== 'sweeping-out' || !sheet?.isConnected) return;
      const t = Math.min(1, Math.max(0, (now - started) / SWEEP_OUT_MS));
      const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      applyPosition(startX + (endX - startX) * eased);
      if (t < 1) {
        frame = requestAnimationFrame(tick);
      } else {
        finish();
      }
    };
    frame = requestAnimationFrame(tick);
  }

  function enterCovered() {
    if (!sheet || !maskMetrics) { finish(); return; }
    const vw = Math.max(320, window.innerWidth);
    const coveredX = direction === 'rtl'
      ? -(maskMetrics.edgeWidth + PIXEL_CELL * 2)
      : -(maskMetrics.maskWidth - vw - maskMetrics.edgeWidth - PIXEL_CELL * 2);
    applyPosition(coveredX);

    if (roomReady) {
      phase = 'holding';
      if (!revealed) {
        revealed = true;
        onReveal?.();
      }
      holdTimer = setTimeout(() => {
        if (phase === 'holding') startSweepOut();
      }, HOLD_MIN_MS);
    } else {
      phase = 'waiting';
      waitTimer = setTimeout(() => {
        if (phase === 'waiting') startSweepOut();
      }, WAIT_TIMEOUT_MS);
    }
  }

  function start({ mode = 'livonym', card = null } = {}) {
    cleanup();
    if (!isInsaneMode(mode) || !wordmarkArt[mode]) return false;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || document.hidden) {
      return false;
    }
    activeMode = mode;
    direction = pixelWaveDirectionForCard(card, mode);
    const vw = Math.max(320, window.innerWidth);
    const vh = Math.max(320, window.innerHeight);
    maskMetrics = buildPixelWaveMask({ width: vw, height: vh, cell: PIXEL_CELL, direction });

    element = document.createElement('div');
    element.className = `insane-curtain insane-curtain--${mode} is-${direction}`;
    element.dataset.mode = mode;
    element.setAttribute('aria-hidden', 'true');
    element.innerHTML = `<div class="insane-curtain-sheet">
      <div class="insane-curtain-waves"></div>
      <div class="insane-curtain-wordmark" lang="en">${wordmarkArt[mode]}</div>
    </div>`;

    sheet = element.querySelector('.insane-curtain-sheet');
    waves = element.querySelector('.insane-curtain-waves');
    sheet.style.maskImage = maskMetrics.dataUri;
    sheet.style.webkitMaskImage = maskMetrics.dataUri;
    sheet.style.maskSize = `${maskMetrics.maskWidth}px ${maskMetrics.maskHeight}px`;
    sheet.style.webkitMaskSize = `${maskMetrics.maskWidth}px ${maskMetrics.maskHeight}px`;
    if (waves) {
      waves.style.width = `${maskMetrics.maskWidth}px`;
      waves.style.height = `${maskMetrics.maskHeight}px`;
    }

    const startX = direction === 'rtl' ? vw + PIXEL_CELL : -(maskMetrics.maskWidth + PIXEL_CELL);
    const endX = direction === 'rtl'
      ? -(maskMetrics.edgeWidth + PIXEL_CELL * 2)
      : -(maskMetrics.maskWidth - vw - maskMetrics.edgeWidth - PIXEL_CELL * 2);

    applyPosition(startX);
    mount().append(element);

    phase = 'sweeping-in';
    roomReady = false;
    revealed = false;
    const started = performance.now();

    const tick = (now) => {
      if (phase !== 'sweeping-in' || !sheet?.isConnected) return;
      const t = Math.min(1, Math.max(0, (now - started) / SWEEP_IN_MS));
      const eased = 1 - Math.pow(1 - t, 2.2);
      applyPosition(startX + (endX - startX) * eased);
      if (t < 1) {
        frame = requestAnimationFrame(tick);
      } else {
        enterCovered();
      }
    };
    frame = requestAnimationFrame(tick);
    return true;
  }

  function notifyRoomReady() {
    roomReady = true;
    if (phase === 'waiting') {
      clearTimeout(waitTimer);
      waitTimer = 0;
      phase = 'holding';
      if (!revealed) {
        revealed = true;
        onReveal?.();
      }
      holdTimer = setTimeout(() => {
        if (phase === 'holding') startSweepOut();
      }, 160);
    }
  }

  function cancel() {
    if (phase === 'idle') return;
    cleanup();
  }

  return {
    start,
    notifyRoomReady,
    cancel,
    mode: () => activeMode,
    isActive: () => phase !== 'idle',
    isSweepingIn: () => phase === 'sweeping-in',
    phase: () => phase
  };
}
