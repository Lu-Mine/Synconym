// 人少时保留邀请的语气，不虚构在线人数。
export function playingText(count) {
  if (!Number.isSafeInteger(count) || count < 0) return '';
  if (count < 2) return '邀请朋友，一起开始吧';
  return `此刻 ${count.toLocaleString('zh-CN')} 人正在游戏`;
}

export async function refreshPlayingCount(element, fetcher = fetch) {
  if (!element) return;
  try {
    const response = await fetcher('/api/playing', { cache: 'no-store' });
    if (!response.ok) throw new Error('人数暂不可用');
    const { playing } = await response.json();
    const text = playingText(playing);
    element.textContent = text;
    element.hidden = !text;
  } catch {
    element.textContent = '';
    element.hidden = true;
  }
}
