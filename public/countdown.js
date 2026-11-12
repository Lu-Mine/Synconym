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

export function updateStartCountdown(element, seconds, remainingMs = seconds === null ? 5000 : seconds * 1000) {
  const scene = element.closest('.start-countdown');
  if (!scene) return;
  syncOrbits(scene, Math.min(5000, Math.max(0, 5000 - remainingMs)));
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
