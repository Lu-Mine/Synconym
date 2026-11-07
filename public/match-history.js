import { escapeHtml } from './render.js';

export function historyQuery(search = '') {
  const params = new URLSearchParams(search);
  const type = ['room', 'uid', 'time'].includes(params.get('type')) ? params.get('type') : 'room';
  return { type, value: params.get('value') || '', from: params.get('from') || '', to: params.get('to') || '',
    page: Math.max(1, Number.parseInt(params.get('page'), 10) || 1), id: params.get('match') || '' };
}

export function historyFilter(query) {
  if (query.type !== 'time') return query.value.trim() ? { type: query.type, value: query.value.trim().toUpperCase() } : {};
  const filter = { type: 'time' };
  if (query.from) filter.from = new Date(`${query.from}T00:00:00`).getTime();
  if (query.to) {
    const end = new Date(`${query.to}T00:00:00`);
    end.setDate(end.getDate() + 1);
    filter.to = end.getTime();
  }
  return query.from || query.to ? filter : {};
}

export function historyHref(query = {}, id = '') {
  const params = new URLSearchParams({ me: '' });
  if (query.type) params.set('type', query.type);
  for (const key of ['value', 'from', 'to']) if (query[key]) params.set(key, query[key]);
  if (query.page > 1) params.set('page', query.page);
  if (id) params.set('match', id);
  return `?${params}`;
}

export function historyInputs(query) {
  if (query.type === 'time') return `<label>开始日期<input class="input" type="date" name="from" value="${escapeHtml(query.from || '')}"></label><label>结束日期<input class="input" type="date" name="to" value="${escapeHtml(query.to || '')}"></label>`;
  const uid = query.type === 'uid';
  return `<label>${uid ? '参与者 UID' : '房号'}<input class="input" type="search" name="value" value="${escapeHtml(query.value || '')}" placeholder="${uid ? '输入完整的 8 位 UID' : '输入 5 位房号'}" pattern="${uid ? '[a-zA-Z0-9]{8}' : '[0-9]{5}'}" maxlength="${uid ? 8 : 5}" ${uid ? '' : 'inputmode="numeric"'} autocomplete="off"></label>`;
}

export function historySearchMarkup(query = {}) {
  const type = query.type || 'room';
  return `<form class="history-search" method="get"><input type="hidden" name="me" value=""><label>搜索方式<select class="input" name="type" id="history-search-type">${[['room', '房号'], ['uid', 'UID'], ['time', '时间']].map(([value, label]) => `<option value="${value}"${type === value ? ' selected' : ''}>${label}</option>`).join('')}</select></label><div id="history-search-inputs" class="history-search-inputs">${historyInputs({ ...query, type })}</div><button class="button primary" type="submit">搜索</button><a class="history-clear" href="?me">清除</a></form>`;
}
