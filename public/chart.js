const COLORS = ['#3D5AFE', '#FF5A46', '#00A878', '#9B6BFF'];
const xml = (value) => String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);

// 每位玩家一条轨迹；相似度越高，轨迹越靠近轮次中心。未知值只作虚线示意。
export function chartMarkup(room) {
  const players = room.resultPlayers || room.players || [];
  const rounds = room.chart || [];
  if (!rounds.length) return '<p class="path-empty">暂无曲线数据</p>';
  const width = Math.max(560, rounds.length * 72 + 90), height = 300;
  const x = (i) => rounds.length === 1 ? width / 2 : 65 + i * (width - 140) / (rounds.length - 1);
  const point = (r, i, p) => {
    const score = r.similarity;
    const spread = (p - (players.length - 1) / 2) * 11 * (1 - (score ?? 0));
    return [x(i) + spread, score == null ? 252 : 240 - score * 200];
  };
  const grid = [0, .5, 1].map((v) => `<line x1="40" y1="${240 - v * 200}" x2="${width - 25}" y2="${240 - v * 200}" stroke="#e4e4e7"/><text x="10" y="${245 - v * 200}" fill="#71717a" font-size="12">${v * 100}%</text>`).join('');
  const paths = players.map((p, pi) => {
    const color = COLORS[p.seat] || COLORS[0];
    return rounds.map((r, i) => {
      const [px, py] = point(r, i, pi);
      const prev = i ? point(rounds[i - 1], i - 1, pi) : null;
      return (prev ? `<line x1="${prev[0]}" y1="${prev[1]}" x2="${px}" y2="${py}" stroke="${color}" stroke-width="2"${r.similarity == null || rounds[i - 1].similarity == null ? ' stroke-dasharray="5 5"' : ''}/>` : '') + `<circle cx="${px}" cy="${py}" r="4" fill="${r.similarity == null ? 'white' : color}" stroke="${color}" stroke-width="2"><title>${xml(p.name)} · 第 ${r.n} 轮 · ${r.similarity == null ? '无法计算' : `${Math.round(r.similarity * 100)}%`}</title></circle>`;
    }).join('');
  }).join('');
  const labels = rounds.map((r, i) => `<text x="${x(i)}" y="280" text-anchor="middle" fill="#71717a" font-size="12">第 ${r.n} 轮</text>`).join('');
  const last = room.history?.at(-1);
  const meeting = ['exact', 'voted'].includes(last?.outcome) ? `<text x="${x(rounds.length - 1)}" y="22" text-anchor="middle" fill="#18181b" font-size="12">${last.outcome === 'voted' ? '投票相遇' : '精确相遇'}</text>` : '';
  return `<svg id="convergence-chart" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" style="min-width:${rounds.length > 6 ? width : 0}px" role="img" aria-label="逐轮收敛曲线，虚线表示无法计算的相似度"><rect width="100%" height="100%" fill="white"/>${grid}${paths}${labels}${meeting}</svg>`;
}
