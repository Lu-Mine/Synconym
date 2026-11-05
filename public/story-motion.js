// Only visible story demonstrations animate; disconnected scenes release their observers.
export function observeStoryMotion(root, { doc = document, Observer = globalThis.IntersectionObserver } = {}) {
  const demos = [...root.querySelectorAll('.home-story-example, .feature-demo')];
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
  return () => {
    observer.disconnect();
    doc.removeEventListener('visibilitychange', updateVisibility);
  };
}
