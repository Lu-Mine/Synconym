// Keep native scrolling while drawing the draggable indicators above the layout.
const rails = new Map();
let scheduled = false;
let dragging = null;

function schedule() {
  if (!scheduled) {
    scheduled = true;
    requestAnimationFrame(update);
  }
}

function update() {
  scheduled = false;
  const root = document.scrollingElement;
  const openModals = [...document.querySelectorAll('.rename-modal.is-open')];
  const topModal = openModals.reduce((top, modal) =>
    !top || Number.parseInt(getComputedStyle(modal).zIndex, 10) >= Number.parseInt(getComputedStyle(top).zIndex, 10) ? modal : top, null);
  const active = new Set();
  const elements = [root, ...document.body.querySelectorAll('*')];
  for (const element of elements) {
    if (element.closest?.('.scrollbar-overlay')) continue;
    if (topModal && !topModal.contains(element)) continue;
    if (getComputedStyle(element).visibility !== 'visible') continue;
    const isRoot = element === root;
    const style = isRoot ? null : getComputedStyle(element);
    const rect = isRoot ? { left: 0, top: 0, right: innerWidth, bottom: innerHeight } : element.getBoundingClientRect();
    for (const axis of ['vertical', 'horizontal']) {
      const vertical = axis === 'vertical';
      const client = vertical ? element.clientHeight : element.clientWidth;
      const size = vertical ? element.scrollHeight : element.scrollWidth;
      const overflow = vertical ? style?.overflowY : style?.overflowX;
      if (!client || size <= client + 1 || (!isRoot && !['auto', 'scroll', 'overlay'].includes(overflow))) continue;
      const start = Math.max(0, vertical ? rect.top : rect.left);
      const end = Math.min(vertical ? innerHeight : innerWidth, vertical ? rect.bottom : rect.right);
      if (end <= start || rect.right <= 0 || rect.left >= innerWidth || rect.bottom <= 0 || rect.top >= innerHeight) continue;
      let pair = rails.get(element);
      if (!pair) { pair = {}; rails.set(element, pair); }
      let item = pair[axis];
      if (!item) {
        const onLeft = axis === 'vertical' && Boolean(element.classList?.contains('scrollbars-left'));
        const rail = document.createElement('div');
        rail.className = `scrollbar-overlay is-${axis}${onLeft ? ' is-left' : ''}`;
        rail.setAttribute('aria-hidden', 'true');
        const thumb = document.createElement('div');
        thumb.className = 'scrollbar-overlay-thumb';
        rail.append(thumb);
        document.body.append(rail);
        item = pair[axis] = { rail, thumb, onLeft };
        rail.addEventListener('pointerdown', event => {
          event.preventDefault();
          const bounds = rail.getBoundingClientRect();
          const position = vertical ? event.clientY - bounds.top : event.clientX - bounds.left;
          const thumbStart = vertical ? thumb.offsetTop : thumb.offsetLeft;
          const thumbSize = vertical ? thumb.offsetHeight : thumb.offsetWidth;
          const grab = event.target === thumb ? position - thumbStart : thumbSize / 2;
          dragging = { element, axis, rail, grab };
          rail.classList.add('is-dragging');
          rail.setPointerCapture(event.pointerId);
          move(event);
        });
        rail.addEventListener('wheel', event => {
          event.preventDefault();
          element.scrollBy({ left: event.deltaX, top: event.deltaY });
        }, { passive: false });
        rail.addEventListener('pointermove', move);
        for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) rail.addEventListener(type, () => {
          if (dragging?.rail === rail) { dragging = null; rail.classList.remove('is-dragging'); }
        });
      }
      active.add(item);
      const length = end - start;
      const thumbLength = Math.min(length, Math.max(24, length * client / size));
      const scroll = vertical ? element.scrollTop : element.scrollLeft;
      const offset = (length - thumbLength) * Math.max(0, Math.min(1, scroll / (size - client)));
      if (vertical) {
        Object.assign(item.rail.style, { top: `${start}px`, left: `${item.onLeft ? rect.left + 2 : Math.min(innerWidth, rect.right) - 10}px`, height: `${length}px` });
        Object.assign(item.thumb.style, { top: `${offset}px`, height: `${thumbLength}px` });
      } else {
        Object.assign(item.rail.style, { left: `${start}px`, top: `${Math.min(innerHeight, rect.bottom) - 10}px`, width: `${length}px` });
        Object.assign(item.thumb.style, { left: `${offset}px`, width: `${thumbLength}px` });
      }
    }
  }
  for (const [element, pair] of rails) {
    for (const axis of ['vertical', 'horizontal']) {
      if (pair[axis] && !active.has(pair[axis])) { pair[axis].rail.remove(); delete pair[axis]; }
    }
    if (!pair.vertical && !pair.horizontal) rails.delete(element);
  }
}

function move(event) {
  if (!dragging || dragging.rail !== event.currentTarget) return;
  const { element, axis, rail, grab } = dragging;
  const vertical = axis === 'vertical';
  const bounds = rail.getBoundingClientRect();
  const thumb = rail.firstElementChild;
  const track = (vertical ? bounds.height - thumb.offsetHeight : bounds.width - thumb.offsetWidth);
  const position = (vertical ? event.clientY - bounds.top : event.clientX - bounds.left) - grab;
  const fraction = track > 0 ? Math.max(0, Math.min(1, position / track)) : 0;
  if (vertical) element.scrollTop = fraction * (element.scrollHeight - element.clientHeight);
  else element.scrollLeft = fraction * (element.scrollWidth - element.clientWidth);
  schedule();
}

const observer = new MutationObserver(records => {
  if (records.some(record => !record.target.closest?.('.scrollbar-overlay') &&
    (record.type !== 'childList' || [...record.addedNodes, ...record.removedNodes].some(node => node.nodeType !== 1 || !node.classList.contains('scrollbar-overlay'))))) schedule();
});
observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class', 'hidden', 'open'] });
new ResizeObserver(schedule).observe(document.documentElement);
document.addEventListener('scroll', schedule, true);
window.addEventListener('resize', schedule);
document.documentElement.classList.add('overlay-scrollbars');
schedule();
