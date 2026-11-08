import { escapeHtml } from './render.js';

const RANGE_SEPARATOR = /\s*(?:~|～|—|–|至|到|\.{2})\s*/;

const pad = (value) => String(value).padStart(2, '0');
const dayLabel = (year, month, day) => `${year}/${pad(month)}/${pad(day)}`;
const YEAR_RANGE = (year) => year >= 1970 && year <= 2999;

// 时间边界：单日、单月、单年都换算成 [from, to) 的本地时间戳，便于服务端半开区间比较。
// label 是完整写法，short 是窄屏徽标用的紧凑写法。
function dayBoundary(year, month, day) {
  if (!YEAR_RANGE(year)) return null;
  const start = new Date(year, month - 1, day);
  if (start.getFullYear() !== year || start.getMonth() !== month - 1 || start.getDate() !== day) return null;
  return { from: start.getTime(), to: start.getTime() + 86400000, label: dayLabel(year, month, day), short: `${pad(month)}/${pad(day)}` };
}

function monthBoundary(year, month) {
  if (!YEAR_RANGE(year) || month < 1 || month > 12) return null;
  return { from: new Date(year, month - 1, 1).getTime(), to: new Date(year, month, 1).getTime(), label: `${year}/${pad(month)}`, short: pad(month) };
}

function yearBoundary(year) {
  if (!YEAR_RANGE(year)) return null;
  return { from: new Date(year, 0, 1).getTime(), to: new Date(year + 1, 0, 1).getTime(), label: String(year), short: String(year) };
}

// 支持的写法：2026-01-01 / 2026/1/1 / 2026.1.1 / 20260101 / 2026年1月1日 / 2026-01 / 202601 / 2026年 / 2026 / 1-1 / 1月1日。
function timeBoundary(text, now = new Date()) {
  let match = /^(\d{4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})\s*日?$/.exec(text);
  if (match) return dayBoundary(+match[1], +match[2], +match[3]);
  match = /^(\d{4})(\d{2})(\d{2})$/.exec(text);
  if (match) return dayBoundary(+match[1], +match[2], +match[3]);
  match = /^(\d{4})\s*[-/.年]\s*(\d{1,2})\s*月?$/.exec(text);
  if (match) return monthBoundary(+match[1], +match[2]);
  match = /^(\d{4})(\d{2})$/.exec(text);
  if (match) return monthBoundary(+match[1], +match[2]);
  match = /^(\d{4})\s*年?$/.exec(text);
  if (match) return yearBoundary(+match[1]);
  match = /^(\d{1,2})\s*[-/.月]\s*(\d{1,2})\s*日?$/.exec(text);
  if (match) return dayBoundary(now.getFullYear(), +match[1], +match[2]);
  return null;
}

// 区间压缩重复的年份：2026/01/01–01/31；跨年时两端都写年份。
const rangeLabel = (left, right, key) => (left.label.slice(0, 4) === right.label.slice(0, 4)
  ? `${left[key]}–${right.short}`
  : `${left[key]}–${right.label}`);

export function parseHistoryTime(raw = '') {
  const text = String(raw ?? '').trim();
  if (!text) return null;
  const parts = text.split(RANGE_SEPARATOR).map((part) => part.trim()).filter(Boolean);
  if (!parts.length || parts.length > 2) return null;
  const first = timeBoundary(parts[0]);
  if (!first) return null;
  if (parts.length === 1) return { from: first.from, to: first.to, label: first.label, short: first.short };
  const second = timeBoundary(parts[1]);
  if (!second) return null;
  const [left, right] = first.from < second.from ? [first, second] : [second, first];
  if (left.from >= right.to) return null;
  return { from: left.from, to: right.to, label: rangeLabel(left, right, 'label'), short: rangeLabel(left, right, 'short') };
}

export function historyQuery(search = '') {
  const params = new URLSearchParams(search);
  const raw = (params.get('q') || '').trim();
  const time = parseHistoryTime(raw);
  return {
    raw,
    value: raw,
    from: time ? time.from : '',
    to: time ? time.to : '',
    label: time ? time.label : '',
    shortLabel: time ? time.short : '',
    page: Math.max(1, Number.parseInt(params.get('page'), 10) || 1),
    id: params.get('match') || ''
  };
}

// 搜索条件不做类型互斥：一段输入同时参与房号、UID、名字、主题与时间（能解析时）的匹配。
export function historyFilter(query = {}) {
  const value = String(query.value ?? query.raw ?? '').trim();
  if (!value) return {};
  const filter = { type: 'any', value };
  if (Number.isFinite(query.from) && Number.isFinite(query.to)) {
    filter.from = query.from;
    filter.to = query.to;
  }
  return filter;
}

export function historyHref(query = {}, id = '') {
  const params = new URLSearchParams({ me: '' });
  if (query.raw) params.set('q', query.raw);
  if (query.page > 1) params.set('page', query.page);
  if (id) params.set('match', id);
  return `?${params}`;
}

// 命中片段高亮；没有可匹配片段时整段高亮。
export function highlightMatch(value, needle = '') {
  const text = String(value ?? '');
  const query = String(needle ?? '').trim();
  const index = query ? text.toLowerCase().indexOf(query.toLowerCase()) : -1;
  if (index < 0) return `<mark class="history-hit">${escapeHtml(text)}</mark>`;
  return `${escapeHtml(text.slice(0, index))}<mark class="history-hit">${escapeHtml(text.slice(index, index + query.length))}</mark>${escapeHtml(text.slice(index + query.length))}`;
}

// 输入即搜：没有提交按钮，能解析成时间时在输入框内右侧标出按哪个区间匹配。
export function historySearchMarkup(query = {}) {
  const raw = String(query.raw || '');
  const time = parseHistoryTime(raw);
  const badge = time
    ? `<span class="history-search-time" id="history-search-time" title="按 ${escapeHtml(time.label)} 匹配">按 ${escapeHtml(time.label)} 匹配</span>`
    : '';
  return `<div class="history-search" role="search" aria-label="搜索对局记录">
      <label class="history-search-field">搜索记录<span class="history-search-box${time ? ' has-time' : ''}"><input class="input" type="search" id="history-search-input" name="q" value="${escapeHtml(raw)}" placeholder="房号、UID、名字、主题或时间" autocomplete="off" spellcheck="false" enterkeyhint="search">${badge}</span></label>
    </div>`;
}
