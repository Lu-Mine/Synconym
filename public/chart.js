const COLORS = ['#3D5AFE', '#FF5A46', '#00A878', '#9B6BFF'];
const xml = (value) => String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);

// 每位玩家一条轨迹；相似度越高，轨迹越靠近轮次中心。未知值只作虚线示意。
export function chartMarkup(room) {
  const players = room.resultPlayers || room.players || [];
  const rounds = room.chart || [];
  if (!rounds.length) return '<p class="path-empty">暂无曲线数据</p>';
  const width = Math.max(560, rounds.length * 72 + 90), height = 332;
  const left = 70, right = width - 48, top = 46, bottom = 238, unknownY = 264;
  const x = (i) => rounds.length === 1 ? width / 2 : left + 18 + i * (right - left - 36) / (rounds.length - 1);
  const y = (score) => bottom - score * (bottom - top);
  const point = (r, i, p) => {
    const score = r.similarity;
    const spread = (p - (players.length - 1) / 2) * 11 * (1 - (score ?? 0));
    return [x(i) + spread, score == null ? unknownY : y(score)];
  };
  const grid = [1, .5, 0].map((v) => `<line x1="${left}" y1="${y(v)}" x2="${right}" y2="${y(v)}" stroke="#E1E4EC"/><text x="${left - 12}" y="${y(v) + 4}" text-anchor="end" fill="#505565" font-size="12">${v * 100}%</text>`).join('');
  // 仅在相邻已知值之间填色，不能跨越未知值制造虚假的面积。
  const areas = rounds.slice(1).map((round, index) => {
    const previous = rounds[index];
    if (previous.similarity == null || round.similarity == null) return '';
    return `<path d="M ${x(index)} ${bottom} L ${x(index)} ${y(previous.similarity)} L ${x(index + 1)} ${y(round.similarity)} L ${x(index + 1)} ${bottom} Z" fill="url(#chart-area-gradient)"/>`;
  }).join('');
  const paths = players.map((p, pi) => {
    const color = COLORS[p.seat] || COLORS[0];
    return rounds.map((r, i) => {
      const [px, py] = point(r, i, pi);
      const prev = i ? point(rounds[i - 1], i - 1, pi) : null;
      const line = prev ? `<line x1="${prev[0]}" y1="${prev[1]}" x2="${px}" y2="${py}" stroke="${color}" stroke-width="2.5" stroke-linecap="round"${r.similarity == null || rounds[i - 1].similarity == null ? ' stroke-dasharray="5 5"' : ''}/>` : '';
      return line + `<circle cx="${px}" cy="${py}" r="4.5" fill="${r.similarity == null ? 'white' : color}" stroke="${r.similarity == null ? color : 'white'}" stroke-width="2"><title>${xml(p.name)} · 第 ${xml(r.n)} 轮 · ${r.similarity == null ? '无法计算' : `${Math.round(r.similarity * 100)}%`}</title></circle>`;
    }).join('');
  }).join('');
  const labels = rounds.map((r, i) => `<text x="${x(i)}" y="312" text-anchor="middle" fill="#505565" font-size="12">第 ${xml(r.n)} 轮</text>`).join('');
  const unknownLabel = rounds.some((round) => round.similarity == null) ? `<text x="${left - 12}" y="${unknownY + 4}" text-anchor="end" fill="#505565" font-size="11">未知</text>` : '';
  const last = room.history?.at(-1);
  const meeting = ['exact', 'voted'].includes(last?.outcome) ? `<text x="${x(rounds.length - 1)}" y="23" text-anchor="middle" fill="#16161A" font-size="12" font-weight="600">${last.outcome === 'voted' ? '投票相遇' : '精确相遇'}</text>` : '';
  return `<svg id="convergence-chart" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" style="min-width:${rounds.length > 6 ? width : 0}px" role="img" aria-label="逐轮收敛曲线，虚线和空心点表示无法计算的相似度" font-family="system-ui, -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif"><defs><linearGradient id="chart-area-gradient" x1="0" y1="${top}" x2="0" y2="${bottom}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#3D5AFE" stop-opacity=".16"/><stop offset="1" stop-color="#3D5AFE" stop-opacity="0"/></linearGradient></defs><rect width="100%" height="100%" fill="white"/>${grid}${areas}${paths}${unknownLabel}${labels}${meeting}</svg>`;
}
