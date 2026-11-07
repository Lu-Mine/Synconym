// 仅当提示文案超出可用空间时滚动；离开主页时释放观察器。
export function observeJoinPlaceholder(root) {
  const viewport = root.querySelector('.join-placeholder');
  const text = viewport?.querySelector('.join-placeholder-text');
  if (!viewport || !text) return () => {};
  const update = () => {
    const overflow = Math.max(0, text.offsetWidth - viewport.clientWidth);
    viewport.style.setProperty('--join-placeholder-offset', `${-overflow}px`);
    viewport.classList.toggle('is-overflowing', overflow > 0);
  };
  update();
  if (typeof ResizeObserver === 'undefined') return () => {};
  const observer = new ResizeObserver(update);
  observer.observe(viewport);
  observer.observe(text);
  return () => observer.disconnect();
}
