window.__SYNCONYM_MOCK__ = true;

// 监听同源父窗口发送的 mock-action 消息，并通过自定义事件转发给真实 app
window.addEventListener('message', (event) => {
  if (event.origin !== window.location.origin) return;
  if (!event.data || typeof event.data !== 'object') return;
  if (event.data.type === 'mock-action') {
    window.dispatchEvent(new CustomEvent('synconym-mock-action', {
      detail: event.data
    }));
  }
});

// 监听真实 app 发送的 synconym-mock-state 事件，向父窗口 postMessage 传递状态
window.addEventListener('synconym-mock-state', (event) => {
  if (!window.parent || window.parent === window) return;
  const detail = event.detail || {};
  window.parent.postMessage({
    type: 'mock-state',
    room: detail.room ?? null,
    mockPausedAt: detail.mockPausedAt ?? null,
    uid: detail.uid ?? null
  }, window.location.origin);
});
