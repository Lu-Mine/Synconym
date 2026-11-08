// 仅当提示文案超出可用空间时滚动；切换页面时释放观察器。
export function observeJoinPlaceholder(root) {
  const viewports = [...root.querySelectorAll('.join-placeholder')];
  const update = (viewport, text) => {
    const overflow = Math.max(0, text.offsetWidth - viewport.clientWidth);
    viewport.style.setProperty('--join-placeholder-offset', `${-overflow}px`);
    viewport.classList.toggle('is-overflowing', overflow > 0);
  };
  const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => {
    for (const [viewport, text] of pairs) update(viewport, text);
  });
  const pairs = viewports.map((viewport) => [viewport, viewport.querySelector('.join-placeholder-text')])
    .filter(([, text]) => text);
  for (const [viewport, text] of pairs) {
    update(viewport, text);
    observer?.observe(viewport);
    observer?.observe(text);
  }
  return () => observer?.disconnect();
}
