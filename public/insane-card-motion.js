// 窄屏狂意卡片动效：让横向像素波直接斜切、裂格并加速坠落为斜向阵雨，无需透明度淡入或折叠裁切。
const MOSAIC_ALPHA = [1, 10 / 15, 13 / 15, 11 / 15];
const EXPAND_DURATION_MS = 560;
const COLLAPSE_DURATION_MS = 500;
const BASE_MORPH_EASE = (t) => (t < 0.5 ? 4 * t * t * t : 1 - ((-2 * t + 2) ** 3) / 2);

function clamp01(value) {
  return value <= 0 ? 0 : value >= 1 ? 1 : value;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function smoothstep(edge0, edge1, x) {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function modPositive(value, modulus) {
  return ((value % modulus) + modulus) % modulus;
}

function cellHash(col, row) {
  const n = Math.sin(col * 127.1 + row * 311.7) * 43758.5453123;
  return n - Math.floor(n);
}

function parseColor(raw, fallback) {
  const value = String(raw || '').trim();
  if (value.startsWith('#') && value.length === 7) {
    return [
      Number.parseInt(value.slice(1, 3), 16),
      Number.parseInt(value.slice(3, 5), 16),
      Number.parseInt(value.slice(5, 7), 16)
    ];
  }
  const match = value.match(/rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)/i);
  if (match) return [Number(match[1]), Number(match[2]), Number(match[3])];
  return fallback;
}

// 复用 styles.css .insane-card::before 三段柔光色带的轮廓。
function wavePacketAlpha(p) {
  const band = (center, half, soft, peak) => {
    const dist = Math.abs(p - center);
    if (dist <= half) return peak;
    if (dist < half + soft) return peak * (1 - (dist - half) / soft);
    return 0;
  };
  const bAlpha = Math.max(
    band(0.185, 0.035, 0.03, 0.14),
    band(0.655, 0.035, 0.03, 0.14)
  );
  const aAlpha = band(0.415, 0.035, 0.03, 0.14);
  return { aAlpha, bAlpha };
}

// 展开态内部斜向像素雨：大间距斜带配合流线断续，与折叠态的间隔波浪节奏保持一致。
function rainGustLayerAlpha(dist, period, width, peak) {
  const p = modPositive(dist, period);
  if (p >= width) return 0;
  const ramp = 5;
  if (p < ramp) return peak * (p / ramp);
  if (p <= width - ramp) return peak;
  return peak * ((width - p) / ramp);
}

// 沿着斜带长度方向（c - r）拆成错落雨滴段，避免死板的长条实心斜线。
function rainDropMask(c, r, dist, period, trackOffset) {
  const bandId = Math.floor(dist / period);
  const seed = Math.floor(cellHash(bandId, trackOffset) * 12);
  const seg = modPositive(Math.floor((c - r) * 0.5) + seed, 5);
  if (seg === 0) return 1;
  if (seg === 1) return 0.78;
  if (seg === 2) return 0;
  if (seg === 3) return 0.88;
  return 0.35;
}

function rgbaStyle([r, g, b], alpha) {
  return `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(4)})`;
}

export function observeInsaneCardMotion(stage) {
  const narrowQuery = window.matchMedia?.('(max-width: 999px)');
  const reducedQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  if (!stage || !narrowQuery || !reducedQuery) return () => {};

  const cards = new Map();
  let previewEntry = null;
  let heroEntry = null;
  let rafId = 0;
  let lastTime = 0;
  let visibleInViewport = true;
  let destroyed = false;

  function activeMotionTargets() {
    if (destroyed || reducedQuery.matches) return { cards: false, preview: false, hero: false };
    return {
      cards: Boolean(stage.querySelector('.insane-list')),
      preview: Boolean(!narrowQuery.matches && stage.querySelector('.insane-preview')),
      hero: Boolean(stage.querySelector('.livonym-history-hero > .livonym-history-hero-canvas'))
    };
  }

  function syncBodyFlags() {
    const targets = activeMotionTargets();
    const active = targets.cards;
    const previewActive = targets.preview;
    document.body.classList.toggle('has-insane-card-motion', active);
    document.body.classList.toggle('has-insane-preview-motion', previewActive);
    document.body.classList.toggle('has-livonym-hero-motion', targets.hero);
    return targets;
  }

  const isEligible = () => {
    const targets = activeMotionTargets();
    return Boolean((targets.cards || targets.preview || targets.hero) && !document.hidden && visibleInViewport);
  };

  function readHostColors(entry) {
    const style = getComputedStyle(entry.host);
    entry.modeA = parseColor(style.getPropertyValue('--mode-a'), [183, 161, 255]);
    entry.modeB = parseColor(style.getPropertyValue('--mode-b'), [243, 173, 207]);
  }

  function createSurfaceEntry(host, canvas, { details = null, index = 0, fixedM = null } = {}) {
    if (!host || !canvas) return null;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const dir = index % 2 === 1 ? -1 : 1;
    const initialM = fixedM !== null ? fixedM : (narrowQuery.matches && details?.open ? 1 : 0);
    const width = Math.max(240, host.clientWidth || 350);
    const height = Math.max(200, host.clientHeight || 320);
    const diagSpan = Math.SQRT1_2 * (width + height);
    const initialPacketW = fixedM === 1 ? Math.max(220, diagSpan * 0.78) : width * 0.75;
    const cycleW = fixedM === 1 ? diagSpan + initialPacketW * 0.72 : width * 1.7625;
    const phaseOffset = fixedM === 1 ? cycleW * 0.45 : (index * 0.8 / 6) * cycleW;
    const entry = {
      host,
      canvas,
      ctx,
      details,
      index,
      dir,
      fixedM,
      mode: host.dataset.mode || '',
      modeA: [183, 161, 255],
      modeB: [243, 173, 207],
      m: initialM,
      fromM: initialM,
      targetM: initialM,
      animStart: 0,
      animDuration: EXPAND_DURATION_MS,
      wavePhase: modPositive(dir > 0 ? phaseOffset : cycleW - phaseOffset, cycleW),
      prevCycleLen: cycleW,
      rainPhaseA: 0,
      rainPhaseB: 0,
      pixelW: 0,
      pixelH: 0,
      dpr: 1
    };
    readHostColors(entry);
    return entry;
  }

  function syncCards() {
    const list = stage.querySelector('.insane-list');
    if (!list) {
      for (const entry of cards.values()) entry.details.removeEventListener('toggle', entry.onToggle);
      cards.clear();
      return;
    }
    const domCards = [...list.querySelectorAll('.insane-card')];
    const seen = new Set(domCards);
    for (const [card, entry] of cards) {
      if (!seen.has(card)) {
        entry.details.removeEventListener('toggle', entry.onToggle);
        cards.delete(card);
      }
    }
    domCards.forEach((card, index) => {
      if (cards.has(card)) {
        const entry = cards.get(card);
        entry.index = index;
        return;
      }
      const entry = createSurfaceEntry(
        card,
        card.querySelector('.insane-card-canvas'),
        { details: card.querySelector('.insane-details'), index }
      );
      if (!entry || !entry.details) return;
      entry.onToggle = () => {
        const target = entry.details.open ? 1 : 0;
        if (target === entry.targetM) return;
        entry.fromM = entry.m;
        entry.targetM = target;
        entry.animStart = performance.now();
        entry.animDuration = target === 1 ? EXPAND_DURATION_MS : COLLAPSE_DURATION_MS;
        startLoop();
      };
      entry.details.addEventListener('toggle', entry.onToggle);
      cards.set(card, entry);
    });
  }

  function syncPreview() {
    const preview = stage.querySelector('.insane-preview');
    const canvas = preview?.querySelector(':scope > .insane-preview-canvas');
    if (!preview || !canvas) {
      previewEntry = null;
      return;
    }
    if (previewEntry && previewEntry.host === preview && previewEntry.canvas === canvas) return;
    previewEntry = createSurfaceEntry(preview, canvas, { fixedM: 1 });
  }

  function syncHero() {
    const hero = stage.querySelector('.livonym-history-hero');
    const canvas = hero?.querySelector(':scope > .livonym-history-hero-canvas');
    if (!hero || !canvas) {
      heroEntry = null;
      return;
    }
    if (heroEntry && heroEntry.host === hero && heroEntry.canvas === canvas) return;
    heroEntry = createSurfaceEntry(hero, canvas, { fixedM: 0 });
  }

  function ensureCanvasSize(entry) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = entry.host.clientWidth;
    const height = entry.host.clientHeight;
    if (!width || !height) return false;
    const targetW = Math.round(width * dpr);
    const targetH = Math.round(height * dpr);
    if (
      entry.canvas.width !== targetW
      || entry.canvas.height !== targetH
      || entry.pixelW !== targetW
      || entry.pixelH !== targetH
      || entry.dpr !== dpr
    ) {
      entry.canvas.width = targetW;
      entry.canvas.height = targetH;
      entry.pixelW = targetW;
      entry.pixelH = targetH;
      entry.dpr = dpr;
    }
    return true;
  }

  function drawEntry(entry, now, dtSec) {
    if (!ensureCanvasSize(entry)) return;
    const hostMode = entry.host.dataset.mode || '';
    if (hostMode && hostMode !== entry.mode) {
      entry.mode = hostMode;
      readHostColors(entry);
    }
    const lockedM = entry.fixedM !== null ? entry.fixedM : (!narrowQuery.matches ? 0 : null);
    if (lockedM !== null) {
      entry.m = lockedM;
      entry.fromM = lockedM;
      entry.targetM = lockedM;
      if (lockedM === 0) {
        entry.rainPhaseA = 0;
        entry.rainPhaseB = 0;
      }
    } else if (entry.m !== entry.targetM) {
      const progress = clamp01((now - entry.animStart) / entry.animDuration);
      entry.m = lerp(entry.fromM, entry.targetM, BASE_MORPH_EASE(progress));
      if (progress >= 1) {
        entry.m = entry.targetM;
        if (entry.m === 0) {
          entry.rainPhaseA = 0;
          entry.rainPhaseB = 0;
        }
      }
    }
    const m = entry.m;
    const width = entry.host.clientWidth;
    const height = entry.host.clientHeight;
    const ctx = entry.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, entry.canvas.width, entry.canvas.height);
    ctx.setTransform(entry.dpr, 0, 0, entry.dpr, 0, 0);

    // 波浪与展开斜雨共用“阵发包络 + 留白间隔”，避免折叠间隔而展开连续造成视觉割裂。
    const theta = m * (Math.PI / 4);
    const cosT = Math.cos(theta);
    const sinT = Math.sin(theta);
    const diagSpan = Math.max(200, cosT * width + sinT * height);
    const packetWidth = lerp(Math.max(120, width * 0.75), Math.max(220, diagSpan * 0.78), m);
    const cycleLen = lerp(width * 1.7625, diagSpan + packetWidth * 0.72, m);

    if (entry.prevCycleLen && Math.abs(cycleLen - entry.prevCycleLen) > 0.01) {
      entry.wavePhase = modPositive(entry.wavePhase * (cycleLen / entry.prevCycleLen), cycleLen);
    }
    entry.prevCycleLen = cycleLen;

    const hVel = entry.dir * (cycleLen / 6);
    const dVel = cycleLen / 6;
    const velocity = lerp(hVel, dVel, smoothstep(0.12, 0.72, m));
    entry.wavePhase = modPositive(entry.wavePhase + velocity * dtSec, cycleLen);

    const rainSpeedA = 46;
    const rainSpeedB = 22;
    const rainDrive = smoothstep(0.08, 0.85, m);
    entry.rainPhaseA += rainSpeedA * rainDrive * dtSec;
    entry.rainPhaseB += rainSpeedB * rainDrive * dtSec;

    // 24px 细网格底纹只在有雨波经过的局部柔和映出，保持空白间隙的通透。
    const gridFade = smoothstep(0.18, 0.9, m);
    if (gridFade > 0.01) {
      ctx.fillStyle = rgbaStyle(entry.modeA, 0.025 * gridFade);
      for (let gx = 0; gx < width; gx += 24) ctx.fillRect(gx, 0, 1, height);
      ctx.fillStyle = rgbaStyle(entry.modeB, 0.025 * gridFade);
      for (let gy = 0; gy < height; gy += 24) ctx.fillRect(0, gy, width, 1);
    }

    // 固定 12px 子格晶格：折叠态两两无缝拼成 20x20 方块，展开时从中间裂开为 9x9 雨点方格。
    const subSize = 10 - m;
    const oddOffset = 10 + 2 * m;
    const subCols = Math.ceil(width / 12) + 1;
    const subRows = Math.ceil(height / 12) + 1;
    const latticeSnap = lerp(24, 12, smoothstep(0.1, 0.75, m));
    const snappedWave = Math.floor(entry.wavePhase / latticeSnap) * latticeSnap;
    const snappedRainA = Math.floor(entry.rainPhaseA / 12) * 12;
    const snappedRainB = Math.floor(entry.rainPhaseB / 12) * 12;

    const bowWeight = 1 - smoothstep(0, 0.62, m);
    const fineSampleBlend = smoothstep(0.15, 0.68, m);
    const wavePresence = 1 - smoothstep(0.22, 0.82, m);
    const rainPresence = smoothstep(0.18, 0.86, m);

    for (let r = 0; r < subRows; r += 1) {
      const macroR = r >> 1;
      const py = (macroR * 24) + ((r & 1) ? oddOffset : 0);
      const subCy = r * 12 + 6;
      const macroCy = macroR * 24 + 12;
      const cy = lerp(macroCy, subCy, fineSampleBlend);
      const bow = entry.dir * 21 * (1 - Math.abs((2 * cy) / height - 1)) * bowWeight;

      for (let c = 0; c < subCols; c += 1) {
        const macroC = c >> 1;
        const px = (macroC * 24) + ((c & 1) ? oddOffset : 0);
        const subCx = c * 12 + 6;
        const macroCx = macroC * 24 + 12;
        const cx = lerp(macroCx, subCx, fineSampleBlend);

        // 波浪与斜向阵雨共享同一推进包裹坐标，按包络首尾渐显、中间留白。
        const tiltedX = cosT * (cx - bow) + sinT * cy;
        const waveRel = modPositive(tiltedX - (snappedWave - packetWidth), cycleLen);
        if (waveRel > packetWidth) continue;

        const u = waveRel / packetWidth;
        const macroMosaic = MOSAIC_ALPHA[((macroR & 1) << 1) | (macroC & 1)];

        let aWave = 0;
        let bWave = 0;
        if (wavePresence > 0.005) {
          const wave = wavePacketAlpha(u);
          aWave = wave.aAlpha * wavePresence * macroMosaic;
          bWave = wave.bAlpha * wavePresence * macroMosaic;
        }

        // 斜向雨线直接从三条波浪色带原位演进：保持阵发留白，并将整条斜带打散成断续雨点。
        let aRain = 0;
        let bRain = 0;
        if (rainPresence > 0.005) {
          const gustEnv = smoothstep(0, 0.12, u) * (1 - smoothstep(0.88, 1, u));
          if (gustEnv > 0.01) {
            const distA = waveRel - packetWidth * 0.415 + 13 - snappedRainA * Math.SQRT1_2;
            const distB = waveRel - packetWidth * 0.185 + 15 - snappedRainB * Math.SQRT1_2;
            const dropA = lerp(macroMosaic, rainDropMask(c, r, distA, 96, 11), smoothstep(0.15, 0.85, m));
            const dropB = lerp(macroMosaic, rainDropMask(c, r, distB, 124, 29), smoothstep(0.15, 0.85, m));
            const localSeed = cellHash(c, r);
            const condense = clamp01((rainPresence * 1.35) - localSeed * 0.25);
            const rainGain = gustEnv * smoothstep(0.05, 0.85, Math.max(rainPresence, condense));
            aRain = rainGustLayerAlpha(distA, 96, 26, 0.15) * dropA * rainGain;
            bRain = rainGustLayerAlpha(distB, 124, 30, 0.11) * dropB * rainGain;
          }
        }

        const totalA = Math.min(0.15, aWave + aRain);
        const totalB = Math.min(0.15, bWave + bRain);
        if (totalA <= 0.002 && totalB <= 0.002) continue;

        if (totalB >= totalA) {
          ctx.fillStyle = rgbaStyle(entry.modeB, totalB);
          ctx.fillRect(px, py, subSize, subSize);
          if (totalA > 0.004) {
            ctx.fillStyle = rgbaStyle(entry.modeA, totalA * 0.65);
            ctx.fillRect(px, py, subSize, subSize);
          }
        } else {
          ctx.fillStyle = rgbaStyle(entry.modeA, totalA);
          ctx.fillRect(px, py, subSize, subSize);
          if (totalB > 0.004) {
            ctx.fillStyle = rgbaStyle(entry.modeB, totalB * 0.65);
            ctx.fillRect(px, py, subSize, subSize);
          }
        }
      }
    }
  }

  function frame(now) {
    rafId = 0;
    const targets = activeMotionTargets();
    if ((!targets.cards && !targets.preview && !targets.hero) || document.hidden || !visibleInViewport) return;
    const dtSec = lastTime ? Math.min(0.05, Math.max(0.001, (now - lastTime) / 1000)) : 1 / 60;
    lastTime = now;
    if (targets.cards) {
      syncCards();
      for (const entry of cards.values()) drawEntry(entry, now, dtSec);
    }
    if (targets.preview) {
      syncPreview();
      if (previewEntry) drawEntry(previewEntry, now, dtSec);
    }
    if (targets.hero) {
      syncHero();
      if (heroEntry) drawEntry(heroEntry, now, dtSec);
    }
    rafId = requestAnimationFrame(frame);
  }

  function startLoop() {
    const targets = syncBodyFlags();
    if (targets.cards) syncCards();
    if (targets.preview) syncPreview();
    if (targets.hero) syncHero();
    if ((!targets.cards && !targets.preview && !targets.hero) || !isEligible()) {
      stopLoop();
      return;
    }
    if (!rafId) {
      lastTime = performance.now();
      rafId = requestAnimationFrame(frame);
    }
  }

  function stopLoop() {
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
    lastTime = 0;
  }

  const layoutTarget = stage.querySelector('.insane-layout') || stage.querySelector('.insane-list') || stage.querySelector('.livonym-history-hero');
  const observer = typeof IntersectionObserver === 'function' && layoutTarget
    ? new IntersectionObserver((entries) => {
        visibleInViewport = entries.some((item) => item.isIntersecting);
        if (visibleInViewport) startLoop();
        else stopLoop();
      })
    : null;
  if (observer && layoutTarget) observer.observe(layoutTarget);

  const onStateChange = () => {
    syncBodyFlags();
    for (const entry of cards.values()) {
      const target = narrowQuery.matches && entry.details.open ? 1 : 0;
      entry.m = target;
      entry.fromM = target;
      entry.targetM = target;
      if (target === 0) {
        entry.rainPhaseA = 0;
        entry.rainPhaseB = 0;
      }
    }
    startLoop();
  };
  document.addEventListener('visibilitychange', onStateChange);
  narrowQuery.addEventListener('change', onStateChange);
  reducedQuery.addEventListener('change', onStateChange);
  startLoop();

  return () => {
    destroyed = true;
    stopLoop();
    observer?.disconnect();
    document.removeEventListener('visibilitychange', onStateChange);
    narrowQuery.removeEventListener('change', onStateChange);
    reducedQuery.removeEventListener('change', onStateChange);
    for (const entry of cards.values()) entry.details.removeEventListener('toggle', entry.onToggle);
    cards.clear();
    previewEntry = null;
    heroEntry = null;
    document.body.classList.remove('has-insane-card-motion', 'has-insane-preview-motion', 'has-livonym-hero-motion');
  };
}
