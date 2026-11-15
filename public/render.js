import { historyHref, historySearchMarkup, highlightMatch } from './match-history.js';
import { DESCRIBE_LIMIT } from './livonym.js';

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

export function avatarDetails(name) {
  const normalizedName = String(name || '').trim();
  const initial = [...normalizedName][0] || '?';
  let hash = 2166136261;
  for (const char of normalizedName) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  hash ^= hash >>> 16;
  return { initial, tone: hash >>> 0 & 3 };
}

export function avatarMarkup(name, className = '', { deleted = false } = {}) {
  const { tone } = avatarDetails(name);
  return `<img class="avatar ${className}" data-avatar-name="${escapeHtml(name)}" data-avatar-tone="${tone}"${deleted ? ' data-avatar-deleted="true"' : ''} alt="" aria-hidden="true">`;
}
// 设备确认：只有本人才认得出的上下文，用来替代不可靠的指纹。
const DEVICE_CLAIM_HINTS = Object.freeze({
  playing: '这个身份正在另一处游玩。接管会让那边断开。',
  multiple: '这台设备上用过多个身份，选一个继续。',
  confirm: '这台设备上用过这个身份，确认一下是不是你。'
});

export function deviceClaimHint(reason = '') {
  return DEVICE_CLAIM_HINTS[reason] || DEVICE_CLAIM_HINTS.multiple;
}

export function deviceClaimItemsMarkup(candidates = []) {
  return candidates.map((candidate) => {
    const context = [
      candidate.lastRoomCode ? `房号 ${candidate.lastRoomCode}` : '',
      candidate.lastOpponentName ? `对手「${candidate.lastOpponentName}」` : ''
    ].filter(Boolean).join(' · ');
    return `<li class="device-claim-item">
        <div class="device-claim-who">${avatarMarkup(candidate.name, 'device-claim-avatar')}<span>${escapeHtml(candidate.name)}</span></div>
        <p class="device-claim-meta">${escapeHtml(context || '还没有对局记录')}</p>
        <button class="button secondary" type="button" data-action="device-claim-yes" data-uid="${escapeHtml(candidate.uid)}"><span>是我</span>${icon('check')}</button>
      </li>`;
  }).join('');
}

export function icon(name, className = '') {
  return `<svg class="icon ${className}" aria-hidden="true"><use href="/icons.svg#icon-${name}"></use></svg>`;
}

// 命中房号时整段高亮，「房号」前缀与数字之间的空格保持原样。
function roomCodeMarkup(code, className = '', hit = false) {
  const label = `房号 ${escapeHtml(code ?? '–')}`;
  return `<span class="room-code-display${className ? ` ${className}` : ''}">${icon('door-open', 'room-code-icon')}<span>${hit ? `<mark class="history-hit">${label}</mark>` : label}</span></span>`;
}

const INSANE_MODE_LABELS = Object.freeze({
  livonym: ['即时竞猜', 'Livonym'],
  shiritori: ['接龙', 'Shiritori'],
  impostor: ['思维卧底', 'Impostor'],
  blitz: ['极速闪电', 'Blitz'],
  bridge: ['语义搭桥', 'Bridge']
});

export function joinRoomModeMarkup(mode) {
  const details = INSANE_MODE_LABELS[mode];
  if (!details) return `<span class="join-room-mode join-room-mode--${escapeHtml(mode || 'classic')}"><span class="join-room-mode-label">模式</span><strong>${escapeHtml(mode === 'theme' ? '主题' : mode === 'free' ? '自由' : '未知')}</strong></span>`;
  return `<span class="join-room-mode join-room-mode--${mode}" data-mode="${mode}" aria-label="房间模式：${details[0]}"><span class="join-room-mode-label">模式</span><strong>${details[0]}</strong><span class="sr-only">${details[1]}</span><span class="join-room-mode-emblem" aria-hidden="true"><i></i><i></i><i></i></span><span class="join-room-mode-wordmark">${wordmarkArt[mode]}</span></span>`;
}


export function brandMarkup() {
  return `<a class="brand" href="/" data-action="home" aria-label="返回近意词 Synconym 主页"><span class="brand-mark" aria-hidden="true"><span class="orb orb-a"></span><span class="orb orb-b"></span></span><span class="brand-cn"><span class="brand-wing-l">近</span><span class="brand-accent brand-yi">意</span><span class="brand-wing-r">词</span></span><span class="brand-en">Syn<span class="brand-accent brand-c">c</span>onym</span></a>`;
}

export function segmented(name, value, options, disabled = false, extra = '') {
  const index = Math.max(0, options.findIndex((option) => String(option.value) === String(value)));
  return `<div class="segmented" role="group" data-segmented="${name}" style="--selected:${index};--count:${options.length + (extra ? 1 : 0)}">${options.map((option) => {
    const isSelected = String(option.value) === String(value);
    return `<button class="segment ${isSelected ? 'selected' : ''}" type="button" data-setting="${name}" data-value="${option.value}" aria-pressed="${isSelected}" ${disabled ? 'disabled' : ''}>${option.label}</button>`;
  }).join('')}${extra}</div>`;
}

const SETTING_VALUE_TEXT = {
  mode: (settings) => (settings.mode === 'theme' ? '主题' : settings.mode === 'livonym' ? '即时竞猜' : '自由'),
  maxRounds: (settings) => `${settings.maxRounds} 轮`,
  writeSeconds: (settings) => `${settings.writeSeconds} 秒`,
  prepareSeconds: (settings) => `${settings.prepareSeconds} 秒`,
  describeSeconds: (settings) => `${settings.describeSeconds} 秒`,
  roundsPerPlayer: (settings) => `${settings.roundsPerPlayer} 轮`,
  banRepeat: (settings) => (settings.banRepeat ? '开启' : '关闭'),
  passwordEnabled: (settings) => (settings.passwordEnabled ? '开启' : '关闭')
};

const DURATIONS = [15, 30, 45, 60];
const SETTING_LEVEL = {
  maxRounds: (settings) => Math.min(3, Math.floor((settings.maxRounds - 4) / 4)),
  writeSeconds: (settings) => Math.max(0, DURATIONS.indexOf(settings.writeSeconds)),
  prepareSeconds: (settings) => Math.max(0, DURATIONS.indexOf(settings.prepareSeconds))
};

export function settingValueText(name, settings) {
  return SETTING_VALUE_TEXT[name](settings);
}

// 四档强度条：点亮到当前档位，与分段选择器的四档一一对应
function levelMeterMarkup(level) {
  return `<span class="level-meter" aria-hidden="true">${Array.from({ length: DURATIONS.length }, (_, index) => (index <= level ? '<i class="is-on"></i>' : '<i></i>')).join('')}</span>`;
}

export function settingValueMarkup(name, settings, control) {
  const level = SETTING_LEVEL[name] ? Math.max(0, SETTING_LEVEL[name](settings)) : -1;
  const state = name === 'banRepeat' ? (settings.banRepeat ? ' is-on' : ' is-off') : '';
  return `<span class="setting-value${state}" data-setting-value="${name}" data-control="${control}">`
    + (name === 'banRepeat' ? icon(settings.banRepeat ? 'check' : 'x', 'setting-value-icon') : '')
    + (level >= 0 ? levelMeterMarkup(level) : '')
    + `<span class="setting-value-text">${escapeHtml(settingValueText(name, settings))}</span>`
    + '</span>';
}

export function settingsMarkup(settings, editable, showInsane = false) {
  // 只读时用纯文本取值替换控件，data-control 记录被替换控件的类型以对齐行高
  const control = (name, type, markup) => (editable ? markup : settingValueMarkup(name, settings, type));
  const insaneEntry = showInsane ? '<a class="insane-portal" href="?insane" data-action="open-insane" aria-label="进入狂意模式"><span>INSANE</span></a>' : '';
  // 即时竞猜用描述时限与每人轮数，经典写词设置不参与流程，不再展示
  const livonym = settings.mode === 'livonym';
  const modeControl = livonym
    ? `<span class="livonym-mode" role="img" aria-label="即时竞猜">${modeWordmarkMarkup('livonym')}</span>`
    : control('mode', 'segmented', segmented('mode', settings.mode, [{ value: 'free', label: '自由' }, { value: 'theme', label: '主题' }], false, insaneEntry));
  return `<section class="settings" data-editable="${editable}" data-mode="${escapeHtml(settings.mode)}" aria-label="房间设置">
    <div class="setting-row">
      <span class="mode-label"><span class="setting-label">模式</span><span class="theme-setting-hint" data-theme-setting-hint ${settings.mode === 'theme' ? '' : 'hidden'}>开始后随机抽取主题。</span></span>
      ${modeControl}
    </div>
    ${livonym ? `<div class="setting-row">
      <span class="setting-label">描述时限</span>
      ${control('describeSeconds', 'segmented', segmented('describeSeconds', settings.describeSeconds, [30, 45, 60].map((value) => ({ value, label: `${value} 秒` }))))}
    </div>
    <div class="setting-row">
      <span class="setting-label">每人轮数</span>
      ${control('roundsPerPlayer', 'segmented', segmented('roundsPerPlayer', settings.roundsPerPlayer, [1, 2].map((value) => ({ value, label: `${value} 轮` }))))}
    </div>` : `<div class="setting-row">
      ${editable ? '<label class="setting-label" for="rounds">轮次上限</label>' : '<span class="setting-label">轮次上限</span>'}
      ${control('maxRounds', 'stepper', `<div class="stepper" role="group" aria-label="轮次上限">
        <button class="stepper-btn" type="button" data-step="-1" aria-label="减少轮次" ${settings.maxRounds <= 4 ? 'disabled' : ''}>${icon('minus')}</button>
        <output id="rounds" class="stepper-value" data-value="${settings.maxRounds}">${settings.maxRounds}</output>
        <button class="stepper-btn" type="button" data-step="1" aria-label="增加轮次" ${settings.maxRounds >= 20 ? 'disabled' : ''}>${icon('plus')}</button>
      </div>`)}
    </div>
    <div class="setting-row">
      <span class="setting-label">写词时限</span>
      ${control('writeSeconds', 'segmented', segmented('writeSeconds', settings.writeSeconds, [15, 30, 45, 60].map((value) => ({ value, label: `${value} 秒` }))))}
    </div>
    <div class="setting-row">
      <span class="setting-label">准备时限</span>
      ${control('prepareSeconds', 'segmented', segmented('prepareSeconds', settings.prepareSeconds, [15, 30, 45, 60].map((value) => ({ value, label: `${value} 秒` }))))}
    </div>
    <div class="setting-row">
      ${editable ? '<label class="setting-label" for="banRepeat">禁止重复词</label>' : '<span class="setting-label">禁止重复词</span>'}
      ${control('banRepeat', 'switch', `<button id="banRepeat" class="switch" type="button" role="switch" aria-checked="${Boolean(settings.banRepeat)}" data-setting="banRepeat" aria-label="禁止重复词"><span class="switch-thumb"></span></button>`)}
    </div>`}
    <div class="setting-row password-setting-row">
      ${editable ? `<label class="setting-label" for="room-password">设置密码</label>
      <div class="password-input-wrap"><input class="input code-input password-input" id="room-password" type="text" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="off" spellcheck="false" value="${escapeHtml(settings.password || '')}" placeholder="留空无密码，或 6 位数字密码" aria-describedby="room-password-hint"><span class="join-placeholder password-placeholder" id="room-password-hint"><span class="join-placeholder-text">留空无密码，或 6 位数字密码</span></span></div>`
      : `<span class="setting-label">设置密码</span>${settingValueMarkup('passwordEnabled', settings, 'switch')}`}
    </div>
  </section>`;
}

// 主题控件用 # 图标；结算类页面的主题控件放在标题区，与房号控件并列。
export function themeMarkup(room) {
  const settled = ['result', 'rematch', 'interrupted'].includes(room.phase);
  return room.mode === 'theme' ? `<p class="current-theme">${settled ? icon('hash', 'current-theme-icon') : ''}<span>${settled ? '本局主题' : '当前主题'}</span><strong>${escapeHtml(room.themeName || '等待抽取')}</strong></p>` : '';
}

// 结算页与历史详情共用的标题区：左侧标题与说明，右侧房号和主题分两行居右；放不下时落到说明下方居中。
function headingMarkup(tag, className, copyHtml, metaHtml) {
  return `<${tag} class="page-heading ${className}"><div class="page-heading-inner"><div class="page-heading-copy">${copyHtml}</div>${metaHtml}</div></${tag}>`;
}

function headingMetaMarkup(code, room) {
  return `<div class="page-heading-meta">${roomCodeMarkup(code, 'heading-room')}<div id="current-theme" class="heading-theme">${themeMarkup(room)}</div></div>`;
}

export function startCountdownMarkup(room) {
  const mode = room?.mode || 'free';
  const insane = isInsaneMode(mode);
  const fx = insane
    ? `<div class="start-countdown-insane-fx" aria-hidden="true"><canvas class="countdown-insane-canvas"></canvas></div>`
    : `<div class="start-countdown-cosmos" aria-hidden="true"><div class="countdown-orbit countdown-orbit-a"><span class="countdown-planet countdown-planet-a"></span></div><div class="countdown-orbit countdown-orbit-b"><span class="countdown-planet countdown-planet-b"></span></div></div>`;
  const wordmark = insane ? modeWordmarkMarkup(mode, 'start-countdown-wordmark') : '';
  return `<div class="start-countdown" data-screen="countdown" data-room="${escapeHtml(room?.code || '')}" data-mode="${escapeHtml(mode)}" data-beat="5">
    ${fx}
    <div class="start-countdown-content">
    <p class="start-countdown-label">准备开始</p>
    <div id="countdown" class="start-countdown-number" role="timer" aria-label="距离开局的秒数" aria-live="off">5</div>
    <div class="start-countdown-progress" aria-hidden="true">${[1, 2, 3, 4, 5].map((step) => `<span data-step="${step}"></span>`).join('')}</div>
    ${mode === 'theme' && room?.themeName ? `<p class="start-countdown-theme"><span>本局主题</span><strong>${escapeHtml(room.themeName)}</strong></p>` : ''}
    </div>
    ${wordmark}
  </div>`;
}

export function settingsSummaryText(settings) {
  const modeText = settings.mode === 'theme' ? '主题' : '自由';
  const repeatText = settings.banRepeat ? '禁重复' : '可重复';
  return `${modeText} · ${settings.maxRounds} 轮 · 写 ${settings.writeSeconds}s`;
}

export function shellMarkup(inRoom = false, user = null, renameOpen = false) {
  const name = user?.name || '';
  const uid = user?.uid || '';
  const identity = `${avatarMarkup(name, 'header-avatar')}<span class="header-user-name" id="header-user-name">${escapeHtml(name)}</span>`;
  // 只在首页让名字与头像整块可点进档案；房间里保持纯展示，避免误触打断对局
  const identityBlock = !inRoom
    ? `<button class="header-profile-trigger" type="button" data-action="open-profile" aria-label="查看我的档案" title="查看我的档案">${identity}</button>`
    : identity;
  return `<header class="site-header" id="site-header" data-in-room="${inRoom}">
    ${brandMarkup()}
    <nav class="header-nav" aria-label="站点链接">
      <a class="site-nav-link header-nav-secondary" href="https://github.com/Lu-Mine/Synconym" rel="noopener">${icon('github', 'footer-github-icon')}<span>GitHub</span></a>
      ${inRoom ? '' : `<button class="header-start" type="button" data-action="open-start">${icon('play')}<span>开始游戏</span></button>`}
      <a class="site-nav-link header-nav-secondary" href="/?qa" ${inRoom ? 'target="_blank" rel="noopener"' : 'data-action="open-qa"'}>${icon('circle-help')}<span>Q&amp;A</span></a>
    </nav>
    <div class="header-actions">
      <div class="header-user ${user ? 'is-visible' : ''}" id="header-user">
        ${identityBlock}
        <button class="icon-button header-rename-trigger" type="button" data-action="rename" aria-label="修改名字" title="修改名字">${icon('pen-line')}<span class="header-rename-label">改名</span></button>
      </div>
    </div>
  </header>
  <div class="rename-modal ${renameOpen ? 'is-open' : ''}" id="rename-modal" ${renameOpen ? '' : 'inert'}>
    <button class="rename-modal-backdrop" type="button" data-action="cancel-rename" aria-label="关闭修改名字窗口"></button>
    <section class="rename-dialog" role="dialog" aria-modal="true" aria-labelledby="rename-title">
      <div class="rename-dialog-heading">
        <h2 id="rename-title">修改名字</h2>
        <button class="icon-button" type="button" data-action="cancel-rename" aria-label="关闭">${icon('x')}</button>
      </div>
      <form id="rename-form" class="rename-form">
        <label for="player-name">名字</label>
        <input id="player-name" class="input" maxlength="12" placeholder="输入新名字（最多 12 字）" required value="${escapeHtml(name)}">
        <p class="rename-uid" id="rename-uid">UID：${escapeHtml(uid)}</p>
        <div class="rename-dialog-actions">
          <button class="button secondary" type="button" data-action="cancel-rename"><span>取消</span>${icon('x')}</button>
          <button class="button primary" type="submit"><span>保存</span>${icon('check')}</button>
        </div>
      </form>
    </section>
  </div>
  <div class="rename-modal transfer-modal" id="transfer-modal" inert>
    <button class="rename-modal-backdrop" type="button" data-action="cancel-transfer" aria-label="取消转让房主"></button>
    <section class="rename-dialog" role="dialog" aria-modal="true" aria-labelledby="transfer-title">
      <div class="rename-dialog-heading">
        <h2 id="transfer-title">转让房主</h2>
        <button class="icon-button" type="button" data-action="cancel-transfer" aria-label="取消">${icon('x')}</button>
      </div>
      <p class="transfer-hint">把房主转给 <strong id="transfer-target-name"></strong> 后，你会变成普通玩家，需要准备后才能开始。</p>
      <div class="rename-dialog-actions">
        <button class="button secondary" type="button" data-action="cancel-transfer"><span>取消</span>${icon('x')}</button>
        <button class="button primary" type="button" data-action="confirm-transfer">${icon('user')}<span>转让房主</span></button>
      </div>
    </section>
  </div>
  <div class="rename-modal confirm-modal" id="confirm-modal" inert>
    <button class="rename-modal-backdrop" type="button" data-action="cancel-confirm" aria-label="取消操作"></button>
    <section class="rename-dialog" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-description">
      <div class="rename-dialog-heading">
        <h2 id="confirm-title">退出房间？</h2>
        <button class="icon-button" type="button" data-action="cancel-confirm" aria-label="取消操作">${icon('x')}</button>
      </div>
      <p class="transfer-hint" id="confirm-description"></p>
      <p class="transfer-hint confirm-step" id="confirm-step" hidden></p>
      <div class="rename-dialog-actions">
        <button class="button secondary" type="button" data-action="cancel-confirm"><span>取消</span>${icon('x')}</button>
        <button class="button danger" type="button" data-action="accept-confirm"><span>退出房间</span>${icon('check')}</button>
      </div>
    </section>
  </div>
  <div class="rename-modal device-claim-modal" id="device-claim-modal" inert>
    <button class="rename-modal-backdrop" type="button" data-action="device-claim-no" aria-label="不是我"></button>
    <section class="rename-dialog" role="dialog" aria-modal="true" aria-labelledby="device-claim-title" aria-describedby="device-claim-context">
      <div class="rename-dialog-heading">
        <h2 id="device-claim-title">继续用原来的身份？</h2>
        <button class="icon-button" type="button" data-action="device-claim-no" aria-label="不是我">${icon('x')}</button>
      </div>
      <p class="transfer-hint" id="device-claim-context"></p>
      <ul class="device-claim-list" id="device-claim-list"></ul>
      <div class="rename-dialog-actions">
        <button class="button secondary" type="button" data-action="device-claim-no"><span>不是我</span>${icon('x')}</button>
      </div>
    </section>
  </div>
  <div class="rename-modal confirm-modal" id="join-modal" inert>
    <button class="rename-modal-backdrop" type="button" data-action="cancel-join" aria-label="取消加入房间"></button>
    <section class="rename-dialog" role="dialog" aria-modal="true" aria-labelledby="join-title" aria-describedby="join-room-number">
      <div class="rename-dialog-heading"><h2 id="join-title">确认加入房间？</h2><button class="icon-button" type="button" data-action="cancel-join" aria-label="取消">${icon('x')}</button></div>
      <div class="join-room-identification">
        <div id="join-room-number">${roomCodeMarkup(null)}</div>
        <div id="join-room-mode" aria-live="polite"></div>
      </div>
      <ul class="player-list" id="join-host"></ul>
      <div id="join-password-fields" hidden>
        <label for="join-password">房间密码</label>
        <input class="input code-input password-input" id="join-password" type="text" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="off" aria-describedby="join-password-hint">
        <p class="hint" id="join-password-hint">此房间已设置密码，请输入房主提供的 6 位数字密码。</p>
      </div>
      <div class="rename-dialog-actions"><button class="button secondary" type="button" data-action="cancel-join"><span>取消</span>${icon('x')}</button><button class="button primary" type="button" data-action="confirm-join"><span>加入房间</span>${icon('check')}</button></div>
    </section>
  </div>
  <div class="rename-modal" id="invite-modal" inert>
    <button class="rename-modal-backdrop" type="button" data-action="close-invite" aria-label="关闭邀请链接窗口"></button>
    <section class="rename-dialog" role="dialog" aria-modal="true" aria-labelledby="invite-title" aria-describedby="invite-hint">
      <div class="rename-dialog-heading">
        <h2 id="invite-title">复制邀请链接</h2>
        <button class="icon-button" type="button" data-action="close-invite" aria-label="关闭">${icon('x')}</button>
      </div>
      <p class="transfer-hint" id="invite-hint">无法自动复制，请手动复制下方链接。</p>
      <input class="input" id="invite-link" aria-label="邀请链接" readonly>
      <div class="rename-dialog-actions">
        <button class="button primary" type="button" data-action="close-invite"><span>完成</span>${icon('check')}</button>
      </div>
    </section>
  </div>
  <div class="rename-modal path-modal" id="path-modal" inert>
    <button class="rename-modal-backdrop" type="button" data-action="close-path" aria-label="关闭思考路径"></button>
    <section class="rename-dialog path-dialog" role="dialog" aria-modal="true" aria-labelledby="path-title">
      <div class="rename-dialog-heading"><h2 id="path-title">${icon('route')}<span>思考路径</span></h2><button class="icon-button" type="button" data-action="close-path" aria-label="关闭思考路径">${icon('x')}</button></div>
      <div id="path-content"></div>
    </section>
  </div>
  <main id="stage" class="stage"></main>
  <div class="rename-modal start-modal" id="start-modal" inert>
    <button class="rename-modal-backdrop" type="button" data-action="close-start" aria-label="关闭开始游戏"></button>
    <section class="rename-dialog start-dialog" role="dialog" aria-modal="true" aria-label="开始游戏">
      <div class="start-entry scrollbars-hidden" id="start-entry"></div>
      <p class="start-hint">点击空白处关闭</p>
    </section>
  </div>
  <footer class="site-footer">${brandMarkup()}<nav class="footer-links" aria-label="页脚链接"><a class="footer-privacy" href="https://github.com/Lu-Mine/Synconym" rel="noopener">${icon('github', 'footer-github-icon')}<span>GitHub</span></a><a class="footer-privacy" href="/?privacy" ${inRoom ? 'target="_blank" rel="noopener"' : 'data-action="open-privacy"'}>${icon('shield-check')}<span>隐私政策</span></a><a class="footer-privacy" href="/?qa" ${inRoom ? 'target="_blank" rel="noopener"' : 'data-action="open-qa"'}>${icon('circle-help')}<span>Q&amp;A</span></a></nav></footer>`;
}

// 常见问题：一条问题一个折叠项，name 相同让浏览器同一时刻只展开一条。
const QA_ENTRIES = [
  ['第一次来，怎么开一局？', [
    '在首页点「创建房间」，把 5 位房号或邀请链接发给朋友就行，不用注册也不用下载。',
    '一轮大概几十秒，一局通常几分钟。觉得太长，可以在创建时或等待大厅里把轮次上限调低。'
  ]],
  ['两个人没写出一样的词，算相遇吗？', [
    '同时揭晓时大家写的是同一个词，直接算相遇。',
    '不是同一个词就进入 5 秒投票，全票选「是」也算相遇；没通过就准备下一轮，看着上一轮的词继续往彼此的方向靠近。'
  ]],
  ['结算页 30 秒里能选什么？', [
    '重赛：全员都选重赛且至少 2 人，按当前设置直接开下一局。',
    '回房间：回到等待大厅，可以改设置再开。回主页：只有你自己离开，不打扰别人。',
    '30 秒内没选，会被移出这间房。'
  ]],
  ['为什么我的词写不进去？', [
    '每次可以写 1–12 个字，只能是汉字、字母和数字；标点和 emoji 打不进去，超过长度会被自动截断。',
    '开了「禁止重复词」时，本局出现过的词不能再写，包括自己用过的。写重会被拦下，但不浪费这一轮，改一下再交。'
  ]],
  ['「iOS 手机」和「ios手机」算同一个词吗？', [
    '算。比较前会统一繁简、大小写、全角半角和空格，所以「臺灣」和「台湾」也视为相同。',
    '字面不同就不算相遇：「海洋」和「大海」意思再近，也不是同一个词。'
  ]],
  ['房间设置哪些能改？', [
    '轮次上限 4–20 轮（默认 12）、写词时限 15/30/45/60 秒（默认 45）、准备时限同样四档（默认 30）、禁止重复词开或关（默认开），还可以选自由或主题模式。',
    '创建时和等待大厅里都能改，开局后锁定。投票时间固定 5 秒，不提供开关。'
  ]],
  ['主题模式是什么？会判我跑题吗？', [
    '每局开始随机抽一个主题并锁定整局，重赛会重新抽，可能又抽到刚才那个。主题只是大家联想的共同范围。',
    '不设禁词，也不会自动判断你的答案算不算切题，靠彼此默契。'
  ]],
  ['刷新、断网或者关掉标签页会怎样？', [
    '席位和已交的词会留 90 秒，期间回来还是原来的位置，游戏不等人。',
    '有人掉线时，准备阶段会多等 10 秒，免得他刚回来就错过下一轮。主动点退出则立刻离开，席位不保留。'
  ]],
  ['玩到一半有人不想继续了？', [
    '轮次上限设到 8 轮以上时，每满 5 轮会停下来问一次：继续下一轮，还是玩崩了。选「玩崩了」的人达到半数，本局就结束且不保存记录。',
    '主动退出只会带走你自己；只剩一个人时本局直接中断，纪录不保存。房间连续 5 分钟没人操作会自动关闭。'
  ]],
  ['名字和 UID 是怎么回事？', [
    '第一次进来会随机分到一个「形容词的水果」，比如「迷人的橙子」。点名字旁的改名按钮随时能换一个，改了之后还是同一个你，对局记录不会断。',
    '在首页点头像或名字能打开档案页：UID、加入时间、用过的名字，以及参与过的对局，每页 10 局。'
  ]],
  ['点「脱离当前身份」会怎样？', [
    '这台设备会换一个新的 UID 和随机名字重新开始，操作要二次确认。',
    '旧身份还在服务器上：别的浏览器或设备还能认回它就保持原样；如果这台设备是唯一入口，脱离后就没有人认得回来，它会一并注销，记录里属于它的内容不再展示。'
  ]]
];

export function qaMarkup() {
  const items = QA_ENTRIES.map(([question, answers]) => `<details class="qa-item" name="qa">
      <summary><span class="qa-question">${escapeHtml(question)}</span>${icon('chevron-down', 'qa-item-icon')}</summary>
      <div class="qa-answer">${answers.map((text) => `<p>${escapeHtml(text)}</p>`).join('')}</div>
    </details>`).join('\n    ');
  return `<article class="privacy-content privacy-in-app qa-content">
    <a class="button secondary privacy-back" href="/" data-action="back">${icon('arrow-right')}<span>返回</span></a>
    <header class="privacy-title"><h1>常见问题</h1><p class="privacy-intro">玩之前想知道的事都在这。点开一条看答案。</p></header>
    <div class="qa-list">
    ${items}
    </div>
    <div class="qa-more">
      <p>还是没解决？</p>
      <a class="button secondary" href="https://github.com/Lu-Mine/Synconym/issues" target="_blank" rel="noopener">${icon('circle-help')}<span>去 GitHub 提 issue</span></a>
    </div>
    <a class="button secondary privacy-back privacy-back-bottom" href="/" data-action="back">${icon('arrow-right')}<span>返回</span></a>
  </article>`;
}

export function privacyMarkup() {
  return `<article class="privacy-content privacy-in-app">
    <a class="button secondary privacy-back" href="/" data-action="back">${icon('arrow-right')}<span>返回</span></a>
    <header class="privacy-title"><h1>隐私说明</h1><p class="privacy-intro">这里说明近意词在游戏过程中使用和保存的数据。请不要在昵称或词语中填写不愿与同局玩家分享的信息。</p></header>
    <nav class="privacy-nav" aria-label="隐私说明目录">
      <span class="privacy-nav-title">页面目录</span>
      <div class="privacy-nav-links">
        <a href="#identity"><span>浏览器里的身份</span>${icon('arrow-down')}</a>
        <a href="#records"><span>游戏中会记录什么</span>${icon('arrow-down')}</a>
        <a href="#deletion"><span>保存与删除</span>${icon('arrow-down')}</a>
        <a href="#hosting"><span>部署环境</span>${icon('arrow-down')}</a>
      </div>
    </nav>
    <div class="privacy-columns">
      <div class="privacy-main">
        <section id="identity"><h2>浏览器里的身份</h2>
          <p>首次访问时，服务端会分配随机 UID、昵称和独立身份凭证。浏览器把 UID 与凭证保存在本地存储中，用于识别和恢复身份；同时设置有效期为 30 天的 UID Cookie。</p>
          <p>为了让你在同一台设备上换浏览器（例如从系统浏览器换到聊天软件里打开）也能回到同一个身份，页面会读取设备自身的特征：操作系统与版本、浏览器名称与主版本、屏幕尺寸与像素比、时区、语言、CPU 核数、设备内存、触点数、显卡型号，以及浏览器提供的机型信息。这些特征与网络无关，换 WiFi 或移动数据不会改变；服务器不会记录你的 IP 用于识别身份。</p>
          <p>这些特征只用来判断「是不是同一台设备」，不参与身份凭证校验。清除浏览器数据可能让你失去原身份和档案的访问方式；此时可以靠设备特征重新认回，或者被提示确认后继续。</p></section>
        <section id="records"><h2>游戏中会记录什么</h2>
          <p>服务器保存 UID、身份凭证的哈希值、当前昵称、曾用名及相关时间。完成的对局会保存房号、模式、时间、结果、参与者昵称和 UID，以及每轮词语、标记和投票记录，用于游戏结算与档案展示。</p>
          <p>游玩时的房间状态和输入内容会在服务器内存中临时处理。写词阶段的内容不会提前展示给其他玩家；揭晓后，同房间玩家可以看到词语和相应的投票结果。崩局或中断的对局不会作为完成记录保存。</p></section>
      </div>
      <div class="privacy-aside">
        <section id="deletion"><h2>保存与删除</h2>
          <p>档案里可以自己动手：单条对局可以从你的记录里移除，移除后仍能在「已移除的记录」里恢复；「清空我的记录」会一次性移除全部对局。这些操作只影响你自己的档案，同局其他玩家的记录不受影响。</p>
          <p>「脱离当前身份」是唯一换身份的入口：这台设备会换成新的 UID 与随机名字。旧身份如果还有别的凭证或设备能认回，就原样保留，记录不受影响；如果这台设备是它唯一的入口，脱离后就没有人认得回来，它会一并注销——名字、曾用名与凭证失效，全部对局里的词、标记与投票不再展示，涉及的对局里显示为「注销用户」，头像变灰，内容显示为 /，之后无法恢复。库里对应的行不擦除，只标记为失效，读的时候跳过。</p>
          <p>为了让数据不留在没人认得的身份下面，服务器启动时也会把既没有有效凭证、也没有设备绑定、且存在超过一小时的身份一并注销。</p>
          <p>注销后可以立即获得一个全新的身份继续使用。站点没有设置其他数据的自动删除期限。</p></section>
        <section id="hosting"><h2>部署环境</h2>
          <p>游戏本身不要求注册手机号或密码。站点运营者使用的服务器、反向代理或托管平台可能另外处理网络连接信息或日志；这些做法取决于实际部署环境，请以该站点运营者提供的信息为准。</p></section>
      </div>
    </div>
    <a class="button secondary privacy-back privacy-back-bottom" href="/" data-action="back">${icon('arrow-right')}<span>返回</span></a>
  </article>`;
}

// 首页演示：只拼装游戏中真实使用的组件，数据取自默认昵称和真实主题。
const DEMO_PLAYERS = [
  { uid: 'demo-a', name: '活泼的苹果', seat: 0, connected: true },
  { uid: 'demo-b', name: '安静的蓝莓', seat: 1, connected: true }
];

function storyDemo(className, scene, markup) {
  return `<div class="story-demo ${className}" data-demo="${scene}" data-story-demo aria-hidden="true" inert>${markup}</div>`;
}

export function stageProgressMarkup(phase) {
  if (['lvIntro', 'lvPlay', 'lvScore'].includes(phase)) return livonymStepsMarkup(phase);
  return [['writing', '写词', 'pen-line'], ['voting', '投票', 'check'], [phase === 'breakVote' ? 'breakVote' : 'prepare', phase === 'breakVote' ? '崩局投票' : '准备', 'play']].map(([step, label, glyph]) => `<span class="stage-step${phase === step ? ' is-current' : ''}"${phase === step ? ' aria-current="step"' : ''}>${icon(glyph)}<span class="stage-step-label">${label}</span></span>`).join('<span class="stage-step-divider" aria-hidden="true">·</span>');
}

// 对局倒计时同款计时器，每一位数字是一条可滚动的 0–9 数字带
function demoClockMarkup(seconds) {
  const reel = (digit) => `<span class="demo-digit"><span class="demo-digit-reel" style="transform:translateY(${-Number(digit) * 10}%)">${Array.from({ length: 10 }, (_, n) => `<span>${n}</span>`).join('')}</span></span>`;
  return `<div class="writing-clock demo-clock">${icon('clock')}<span class="demo-clock-value">${String(seconds).padStart(2, '0').split('').map(reel).join('')}<span> 秒</span></span></div>`;
}

function storyDemos() {
  const [a, b] = DEMO_PLAYERS;
  const lobby = { code: '12345', hostUid: a.uid, phase: 'lobby', players: DEMO_PLAYERS };
  const words = (left, right) => ({ [a.uid]: left, [b.uid]: right });
  const day = (date) => new Date(2026, 10, date).getTime();
  const matches = [
    { outcome: 'exact', convergedRound: 2, startedAt: day(5), roomCode: '12345', players: [a.name, b.name] },
    { outcome: 'voted', convergedRound: 4, startedAt: day(3), roomCode: '58213', themeName: '王者荣耀', players: [a.name, b.name] },
    { outcome: 'none', totalRounds: 12, startedAt: day(1), roomCode: '30476', players: [a.name, b.name] }
  ];
  const durations = [15, 30, 45, 60].map((value) => ({ value, label: `${value} 秒` }));
  const demoButton = (className, attrs, inner) => `<button class="button ${className}" type="button" tabindex="-1" ${attrs}>${inner}</button>`;
  return {
    example: `<ul class="word-grid">${wordCardMarkup(a, '海洋')}${wordCardMarkup(b, '天空')}</ul><div class="path-connector">${icon('arrow-down')}</div><ul class="word-grid story-meet">${wordCardMarkup(a, '蓝色')}${wordCardMarkup(b, '蓝色')}</ul>`,
    round: `<div class="writing-stage"><div class="stage-meta"><span class="stage-round">第 <span data-demo-round>1</span> / 12 轮</span><nav class="stage-progress">${stageProgressMarkup('writing')}</nav>${roomCodeMarkup('12345', 'stage-room')}</div></div>`
      + `<div class="demo-panels"><div class="surface-block game-form is-shown" data-demo-panel="write"><label>你的词</label><div class="input is-focused demo-input"><span data-demo-typed>海洋</span><i class="demo-caret"></i></div><p class="game-hint">可使用空格；超时将提交输入框中的内容</p>${demoButton('primary', 'data-demo-submit', `<span>提交</span>${icon('check')}`)}</div>`
      + `<div data-demo-panel="reveal"><section class="surface-block"><div class="section-heading"><h2>本轮的词</h2></div><ul class="word-grid">${wordCardMarkup(a, '海洋')}${wordCardMarkup(b, '天空')}</ul></section><div class="game-actions">${demoButton('primary', 'data-demo-vote', `<span>是</span>${icon('check')}`)}${demoButton('secondary', 'data-demo-vote', `<span>否</span>${icon('x')}`)}</div></div></div>`
      + '<div class="toast">未通过</div>',
    theme: `${segmented('demo-mode', 'theme', [{ value: 'free', label: '自由' }, { value: 'theme', label: '主题' }])}<div class="writing-stage"><div class="stage-copy"><h1>各自写下此刻想到的词</h1><p>词语会在所有人提交后揭晓</p></div><div class="stage-theme">${themeMarkup({ mode: 'theme', phase: 'writing', themeName: '王者荣耀' })}</div></div>`,
    settings: `${demoClockMarkup(45)}<div class="setting-row"><span class="setting-label">写词时限</span>${segmented('demo-write', 45, durations)}</div><div class="setting-row"><span class="setting-label">禁止重复词</span><button class="switch" type="button" role="switch" aria-checked="true" tabindex="-1"><span class="switch-thumb"></span></button></div>`,
    reconnect: `<ul class="player-list">${playerItemMarkup(a, lobby, '')}${playerItemMarkup({ ...b, ready: true }, lobby, '')}</ul>`,
    path: thoughtPathMarkup({ phase: 'result', players: DEMO_PLAYERS, history: [{ n: 1, words: words('海洋', '天空'), marks: {} }, { n: 2, words: words('蓝色', '蓝色'), marks: {} }] }),
    profile: `<ol class="profile-matches">${matches.map(profileMatchMarkup).join('')}</ol>`,
    vote: `<div class="demo-scene-break"><div class="writing-stage"><nav class="stage-progress">${stageProgressMarkup('breakVote')}</nav><h1>继续下一轮，还是结束本局？</h1></div>`
      + `<section class="surface-block"><div class="section-heading"><h2>玩家状态</h2></div><ul class="game-status-list">${gameStatusItemMarkup(a, 'done', '已投票', true)}${gameStatusItemMarkup(b, 'done', '已投票', false)}</ul></section>`
      + `<div class="game-actions">${demoButton('primary', 'data-action="break-no" disabled', `${icon('arrow-right')}<span>下一轮</span>`)}${demoButton('primary', 'data-action="break-yes" disabled', `<span>玩崩了</span>${icon('x')}`)}</div></div>`
  };
}

// 入口区：首页正文与顶栏「开始游戏」弹窗共用同一份结构
export function homeEntryMarkup(settings, settingsOpen = false) {
  return `<div class="home-entry">
    <section class="intro">
      <div class="intro-logo" role="img" aria-label="近意词 Synconym">
        <span class="intro-orbits" aria-hidden="true"><span class="intro-orb intro-orb-a"></span><span class="intro-orb intro-orb-b"></span></span>
        <span class="brand-cn" aria-hidden="true"><span class="brand-wing-l">近</span><span class="brand-accent brand-yi">意</span><span class="brand-wing-r">词</span></span><span class="brand-en" aria-hidden="true">Syn<span class="brand-accent brand-c">c</span>onym</span>
      </div>
      <h1>各自想一个，直到想到一起。</h1>
      <p>两个词之间，藏着我们想到的同一个东西。</p>
    </section>

    <div class="entry-deck">
      <form id="create-form" class="create-card">
        <button class="button primary create-submit" type="submit">
          <span class="create-submit-content"><span class="create-submit-label"><span>创建房间</span><span class="playing-count" id="playing-count" hidden></span></span>${icon('arrow-right', 'create-submit-arrow')}</span>
        </button>
        <div class="drawer-shell ${settingsOpen ? 'is-open' : ''}" id="home-settings-drawer">
          <button class="drawer-trigger" type="button" data-action="toggle-settings" aria-expanded="${settingsOpen}" aria-controls="home-settings-panel">
            <span class="drawer-trigger-title">${icon('sliders-horizontal')}<span>房间设置</span></span>
            <span class="drawer-summary" id="settings-summary">${escapeHtml(settingsSummaryText(settings))}</span>
          </button>
        </div>
        <div class="drawer-grid ${settingsOpen ? 'is-open' : ''}" id="home-settings-panel" ${settingsOpen ? '' : 'inert'}>
          <div class="drawer-inner">
            ${settingsMarkup(settings, true, true)}
          </div>
        </div>
      </form>

      <div class="entry-divider" role="separator"><span>或者加入朋友的房间</span></div>

      <form id="join-form" class="join-form">
        <label class="sr-only" for="room-code">5 位房号或邀请链接</label>
        <div class="join-input-wrap"><input id="room-code" name="code" class="input code-input" type="text" inputmode="numeric" placeholder="输入 5 位数房间号，或直接粘贴邀请链接" autocomplete="off" spellcheck="false" required><span class="join-placeholder" aria-hidden="true"><span class="join-placeholder-text">输入 5 位数房间号，或直接粘贴邀请链接</span></span><button class="paste-invite" type="button" data-action="paste-invite">${icon('clipboard-paste')}<span>粘贴邀请链接</span></button></div>
        <button class="recent-room" id="recent-room" type="button" data-action="join-recent-room" hidden>${icon('rotate-ccw')}<span>回到最近的房间</span><strong></strong>${icon('arrow-right')}</button>
      </form>
    </div>
  </div>`;
}

export function homeMarkup(settings, settingsOpen = false) {
  const demos = storyDemos();
  return `<div class="page home-page" data-screen="home">
    ${homeEntryMarkup(settings, settingsOpen)}
    <a class="home-story-link" href="#home-story-title">了解玩法 ${icon('arrow-down')}</a>
    <section class="home-story" aria-labelledby="home-story-title">
      <div class="home-story-pages" id="home-story-pages" tabindex="0" role="region" aria-label="玩法介绍，可滑动翻页">
      <div class="home-story-page home-story-overview">
      <div class="home-story-heading">
        <h2 id="home-story-title">${icon('sparkles', 'story-heading-icon')}<span>从不同的想法，走到同一个答案。</span></h2>
        <p>和 2–4 位朋友一起，用词语寻找彼此的默契。</p>
      </div>
      ${storyDemo('home-story-example', 'meet', demos.example)}
      </div>
      <div class="home-story-how home-story-page">
        <h3>${icon('play', 'story-heading-icon')}<span>怎么玩？</span></h3>
        ${storyDemo('round-demo', 'round', demos.round)}
        <ol>
          <li><strong>${icon('pen-line', 'story-icon')}<span>各自写词</span></strong><span>同时写下一个词，揭晓前互相看不到。</span></li>
          <li><strong>${icon('check', 'story-icon')}<span>揭晓与投票</span></strong><span>词语相同即刻相遇；不同也可以投票，全票通过就算相遇。</span></li>
          <li><strong>${icon('arrow-right', 'story-icon')}<span>继续靠近</span></strong><span>还没相遇？根据上一轮的词继续联想，直到相遇或达到轮次上限。</span></li>
        </ol>
      </div>
      <div class="home-story-features">
        <h3>${icon('book-open', 'story-heading-icon')}<span>每一局，都可以不一样</span></h3>
        <div class="home-feature-list">
          <article><div class="feature-copy"><h4>${icon('lightbulb', 'story-icon')}<span>自由联想，或一起聊主题</span></h4><p>自由模式随心发挥；主题模式在每局开始时随机抽取一个主题，给想法一个共同方向。</p></div>${storyDemo('feature-demo demo-theme', 'theme', demos.theme)}</article>
          <article><div class="feature-copy"><h4>${icon('sliders-horizontal', 'story-icon')}<span>房间规则，由你们决定</span></h4><p>调整轮次上限、写词和准备时限，也可以选择是否禁止重复词。用房号或邀请链接叫朋友加入。</p></div>${storyDemo('feature-demo demo-settings', 'settings', demos.settings)}</article>
          <article><div class="feature-copy"><h4>${icon('rotate-ccw', 'story-icon')}<span>掉线也能回来</span></h4><p>大厅和对局中断线后，席位暂时保留；及时重连即可回到当前进度。</p></div>${storyDemo('feature-demo demo-reconnect', 'reconnect', demos.reconnect)}</article>
          <article><div class="feature-copy"><h4>${icon('route', 'story-icon')}<span>回看你们的思考路径</span></h4><p>结算时回顾每轮词语、投票和相似度曲线，再选择重赛、回房间或回主页。</p></div>${storyDemo('feature-demo demo-path', 'path', demos.path)}</article>
          <article><div class="feature-copy"><h4>${icon('user', 'story-icon')}<span>留下自己的对局记录</span></h4><p>在个人档案查看 UID、曾用名和完成的对局；昵称可以随时修改。</p></div>${storyDemo('feature-demo demo-profile', 'profile', demos.profile)}</article>
          <article><div class="feature-copy"><h4>${icon('clock', 'story-icon')}<span>长局也有重新选择的机会</span></h4><p>轮次上限至少为 8 时，每完成 5 轮仍未相遇且尚未达到上限，会发起崩局投票；达到半数选择玩崩了，本局结束且不保存记录。</p></div>${storyDemo('feature-demo demo-vote', 'break', demos.vote)}</article>
        </div>
      </div>
      <div class="home-story-cta">
        <div class="surface-block home-story-cta-panel">
          <p class="home-story-cta-copy">${icon('sparkles', 'home-story-cta-mark')}<span>看到这里，可以开局了</span></p>
          <a class="button primary home-story-cta-button" href="#create-form" data-action="home-to-entry"><span>开始游戏</span>${icon('arrow-right', 'home-story-cta-icon')}</a>
        </div>
      </div>
      </div>
      <nav class="home-story-pagination" aria-label="玩法介绍翻页">
        <button type="button" data-story-step="-1" aria-label="上一页" disabled>${icon('arrow-left')}</button>
        <span class="home-story-page-count" aria-live="polite">1 / 9</span>
        <button type="button" data-story-step="1" aria-label="下一页">${icon('arrow-right')}</button>
      </nav>
    </section>
  </div>`;
}

function profileDate(timestamp) {
  const date = new Date(timestamp);
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// 对局时间：一周内相对显示，一年内显示月/日与 24 小时时间，更早只显示年月日。
export function relativeDate(timestamp, now = Date.now()) {
  if (!Number.isFinite(timestamp)) return '';
  const date = new Date(timestamp);
  const pad = (value) => String(value).padStart(2, '0');
  const elapsed = Math.max(0, now - timestamp);
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (elapsed < minute) return '刚刚';
  if (elapsed < hour) return `${Math.floor(elapsed / minute)} 分钟前`;
  if (elapsed < day) return `${Math.floor(elapsed / hour)} 小时前`;
  if (elapsed < 7 * day) return `${Math.floor(elapsed / day)} 天前`;
  if (elapsed >= 365 * day) return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())}`;
  return `${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function profileMatchMarkup(match, query = {}, options = {}) {
  const livonym = match.mode === 'livonym';
  const met = match.outcome !== 'none';
  const outcome = livonym
    ? `共 ${match.totalRounds} 棒`
    : met
      ? `第 ${match.convergedRound} 轮${match.outcome === 'voted' ? '投票' : ''}相遇`
      : `打满 ${match.totalRounds} 轮未相遇`;
  // 服务端只下发同局的其他人；已注销的人显示为「注销用户」，头像同时变灰。
  const others = (match.players || []).map((player) => (typeof player === 'string'
    ? { name: player, deleted: false } : { name: player.name, deleted: Boolean(player.deleted) }));
  // hits 来自服务端：一条记录可能在多个维度上被搜到，命中的那几处分别高亮
  const hits = match.hits || {};
  const hitNames = new Map((hits.names || []).map((hit) => [hit.name, hit.whole]));
  const names = others.map((player) => (hitNames.has(player.name)
    ? highlightMatch(player.name, hitNames.get(player.name) ? '' : query.value)
    : escapeHtml(player.name))).join('、');
  const avatars = others.slice(0, 3)
    .map((player) => avatarMarkup(player.name, 'profile-match-avatar', { deleted: player.deleted })).join('');
  const rest = others.length > 3 ? `<span class="profile-match-avatar-rest">+${others.length - 3}</span>` : '';
  const startedAt = Number.isFinite(match.startedAt) ? new Date(match.startedAt).toISOString() : '';
  const date = relativeDate(match.startedAt);
  const theme = match.themeName ? (hits.theme ? highlightMatch(match.themeName, query.value) : escapeHtml(match.themeName)) : '';
  const plainNames = others.map((player) => player.name).join('、') || '无对手';
  const action = options.removable
    ? `<button class="icon-button profile-match-remove" type="button" data-action="delete-match" data-id="${escapeHtml(match.id)}" aria-label="移除这一局（对手 ${escapeHtml(plainNames)}，${escapeHtml(date)}）" title="从我的记录里移除">${icon('trash-2')}</button>`
    : options.restorable
      ? `<button class="icon-button profile-match-remove" type="button" data-action="restore-match" data-id="${escapeHtml(match.id)}" aria-label="恢复这一局（对手 ${escapeHtml(plainNames)}，${escapeHtml(date)}）" title="恢复到我的记录">${icon('rotate-ccw')}</button>`
      : '';
  return `<li class="profile-match">
        <a class="profile-match-link" href="${escapeHtml(historyHref(query, match.id))}">
        <span class="profile-match-heading">
          <span class="profile-match-avatars" aria-hidden="true">${avatars}${rest}</span>
          <span class="profile-match-names">${names}</span>
          <time class="profile-match-date" datetime="${startedAt}">${hits.time ? highlightMatch(date) : escapeHtml(date)}</time>
        </span>
        <span class="profile-match-meta">
          <span class="profile-match-outcome" data-outcome="${escapeHtml(match.outcome)}">${icon(met ? 'check' : 'x', 'profile-match-icon')}<span>${escapeHtml(outcome)}</span></span>
          ${roomCodeMarkup(match.roomCode, 'profile-match-room', Boolean(hits.room))}
          ${theme ? `<span class="profile-match-theme">${icon('tag', 'profile-match-icon')}<span>${theme}</span></span>` : ''}
        </span>
        <span class="profile-match-open">查看详情 ${icon('arrow-right')}</span></a>
        ${action}
      </li>`;
}

// 档案：只展示自己的身份与对局，每页 10 局，可翻完全部记录。
export function profileMarkup(state) {
  const profile = state.profile;
  if (!profile) {
    return `<div class="page profile-page" data-screen="profile"><p class="profile-empty" role="status">${escapeHtml(state.profileError || '正在读取档案…')}</p>${state.profileError ? '<a class="history-clear" href="?me">清除搜索条件并重试</a>' : ''}</div>`;
  }
  const { user } = profile;
  const matches = profile.matches || [];
  const page = profile.page || 1;
  const pages = Math.max(1, Math.ceil((profile.total || 0) / (profile.pageSize || 10)));
  const former = (profile.nameHistory || []).map((item) => item.name).filter((name) => name !== user.name);
  const pager = pages > 1
    ? `<div class="profile-pager">
        <button class="button secondary" type="button" data-action="profile-prev" ${page <= 1 ? 'disabled' : ''}><span>上一页</span></button>
        <span class="profile-page-count">第 ${page} / ${pages} 页</span>
        <button class="button secondary" type="button" data-action="profile-next" ${page >= pages ? 'disabled' : ''}><span>下一页</span></button>
      </div>`
    : '';
  const removedBlock = state.removed
    ? `<div class="surface-block profile-removed">
        <div class="section-heading"><h2>${icon('trash-2')}<span>已移除的记录</span></h2><span class="profile-total">${state.removed.total || 0} 局</span></div>
        ${state.removed.matches?.length
          ? `<ol class="profile-matches">${state.removed.matches.map((match) => profileMatchMarkup(match, {}, { restorable: true })).join('')}</ol>`
          : '<p class="profile-empty">没有已移除的记录。移除后的对局会出现在这里，随时可以恢复。</p>'}
      </div>`
    : '';
  return `<div class="page profile-page" data-screen="profile">
    <section class="surface-block profile-identity">
      ${avatarMarkup(user.name, 'profile-avatar')}
      <div class="profile-identity-text">
        <h1 class="profile-name">${escapeHtml(user.name)}</h1>
        <p class="profile-uid">UID：${escapeHtml(user.uid)}<button class="icon-button profile-uid-copy" type="button" data-action="copy-uid" aria-label="复制 UID" title="复制 UID">${icon('copy')}</button></p>
        <p class="profile-meta">${icon('clock')}<span>加入于 ${escapeHtml(profileDate(user.createdAt))}${former.length ? ` · 曾用名 ${escapeHtml(former.join('、'))}` : ''}</span></p>
      </div>
    </section>
    <p class="profile-privacy">这台设备上换浏览器也会认出你。服务器保存凭证的哈希值、名字和完成过的对局记录。</p>
    <div class="profile-actions">
      <button class="button secondary" type="button" data-action="back">${icon('arrow-left')}<span>返回</span></button>
      <button class="button secondary" type="button" data-action="clear-history">${icon('trash-2')}<span>清空我的记录</span></button>
      <button class="button danger" type="button" data-action="leave-identity">${icon('user-x')}<span>脱离当前身份</span></button>
    </div>
    <section class="surface-block profile-history">
      <div class="section-heading"><h2>${icon('route')}<span>对局记录</span></h2><span class="profile-total">${profile.total || 0} 局</span>${profile.removed ? `<button class="button secondary profile-removed-link" type="button" data-action="open-removed"><span>已移除 ${profile.removed} 局</span></button>` : ''}</div>
      ${historySearchMarkup(state.historyQuery)}
      ${matches.length
        ? `<ol class="profile-matches">${matches.map((match) => profileMatchMarkup(match, state.historyQuery, { removable: true })).join('')}</ol>`
        : `<p class="profile-empty">${profile.filter?.type ? '没有符合条件的对局，请调整搜索条件。' : '还没有完成的对局。开一局，回来就能看到。'}</p>`}
      ${pager}
    </section>
    ${removedBlock}
  </div>`;
}

export function playerItemMarkup(player, room, uid) {
  const isMe = player.uid === uid;
  const isHost = player.uid === room.hostUid;
  const isReady = !isHost && player.ready;
  const statusKey = !player.connected ? 'away' : isHost ? 'host' : isReady ? 'done' : 'waiting';
  const canTransfer = room.phase === 'lobby' && room.hostUid === uid && !isHost && player.connected;
  return `<li class="player status-${statusKey} ${isHost ? 'is-host' : ''} ${isReady ? 'is-ready' : ''} ${isMe ? 'is-me' : ''} ${canTransfer ? 'is-transferable' : ''}" data-uid="${escapeHtml(player.uid)}"${canTransfer
    ? ` data-action="transfer-host" tabindex="0" role="button" title="点击把房主转给 ${escapeHtml(player.name)}"`
    : ''} style="--player:var(--player-${player.seat})">
    ${avatarMarkup(player.name)}
    <div class="player-meta">
      <div class="player-name-row">
        <span class="player-name">${escapeHtml(player.name)}</span>
        ${isMe ? `<button class="icon-button rename-trigger" type="button" data-action="rename" aria-label="修改名字" title="修改名字">${icon('pen-line')}</button>` : ''}
        ${isMe ? '<span class="badge me-label">你</span>' : ''}
      </div>
    </div>
    <span class="ready-state">${icon({ host: 'user', waiting: 'clock', done: 'check', away: 'log-out' }[statusKey], 'game-status-icon')}<span>${{ host: '房主', waiting: '未准备', done: '已准备', away: '连接中断' }[statusKey]}</span></span>
  </li>`;
}

// 狂意系列玩法：房间沿用狂意页的背景与深色色板，自由与主题房间保持原样。
export const INSANE_MODES = ['livonym', 'shiritori', 'impostor', 'blitz', 'bridge'];

export function isInsaneMode(mode) {
  return INSANE_MODES.includes(mode);
}

const ROOM_PLAYER_LIMITS = Object.freeze({
  free: [2, 4],
  theme: [2, 4],
  livonym: [3, 8],
  shiritori: [2, 4],
  impostor: [3, 6],
  blitz: [2, 2],
  bridge: [2, 4]
});

export function roomPlayerLimits(mode) {
  return ROOM_PLAYER_LIMITS[mode] || ROOM_PLAYER_LIMITS.free;
}

export function roomMinPlayers(mode) {
  return roomPlayerLimits(mode)[0];
}

export function roomCapacity(mode) {
  return roomPlayerLimits(mode)[1];
}

export function canStartRoom(room, uid) {
  const [minPlayers, maxPlayers] = roomPlayerLimits(room?.mode);
  const count = room?.players?.length ?? 0;
  return Boolean(room)
    && room.hostUid === uid
    && count >= minPlayers
    && count <= maxPlayers
    && room.players
      .filter((player) => player.uid !== room.hostUid)
      .every((player) => player.ready && player.connected);
}

export function lobbyPlayersMarkup(room, uid) {
  const [minPlayers, capacity] = roomPlayerLimits(room.mode);
  const hint = minPlayers === capacity ? `${capacity} 人即可开玩` : `${minPlayers}–${capacity} 人即可开玩`;
  const players = room.players.map((player) => playerItemMarkup(player, room, uid)).join('');
  const emptyCount = Math.max(0, capacity - room.players.length);
  const emptySeat = `<li class="player player-empty"><span class="player-empty-avatar" aria-hidden="true"></span><span>${hint}</span></li>`;
  if (capacity <= 4 || emptyCount <= 1) return players + emptySeat.repeat(emptyCount);
  const foldedCount = emptyCount - 1;
  return `${players}${emptySeat}<li class="player player-empty-more"><span class="player-empty-more-avatar" aria-hidden="true">${icon('ellipsis', 'player-empty-more-icon')}</span><span>还有 ${foldedCount} 个空位</span></li>`;
}

export function settingsBlockMarkup(room, host) {
  return `<section class="surface-block settings-block">
    <div class="section-heading">
      <h2>${icon('sliders-horizontal')}<span>房间设置</span></h2>
      ${!host ? '<span class="readonly-tag">房主可改</span>' : ''}
    </div>
    ${settingsMarkup(room, host)}
  </section>`;
}

export function lobbyMarkup(state) {
  const { room, uid } = state;
  const me = room.players.find((player) => player.uid === uid);
  const host = room.hostUid === uid;
  const canStart = canStartRoom(room, uid);
  return `<div class="page lobby-page" data-screen="lobby" data-room="${escapeHtml(room.code)}">
    <div class="lobby-info">
    <section class="room-banner">
      <div class="room-heading-copy">
        <div class="room-heading-row">
          <h1>等待大家准备</h1>
          <div class="idle-clock" role="timer" aria-live="off" title="房间空闲 5 分钟后自动关闭">
            ${icon('clock')}
            <span id="idle-countdown"></span>
          </div>
        </div>
        <p>邀请朋友，准备好后由房主开始。</p>
      </div>
      <button class="room-code-ticket" type="button" data-action="copy" aria-label="复制邀请链接" title="复制邀请链接">
        <span class="ticket-caption">房间号</span>
        <span class="ticket-code-row">
          ${icon('copy', 'ticket-copy-icon')}
          <span class="ticket-code" id="lobby-room-code">${escapeHtml(room.code)}</span>
        </span>
      </button>
    </section>

    <section class="surface-block players-block" aria-label="房间玩家">
      <div class="section-heading">
        <h2>${icon('users')}<span>玩家</span></h2>
        <span class="player-count" id="player-count">${room.players.length} / ${roomCapacity(room.mode)}</span>
      </div>
      <ul class="player-list" id="player-list">
        ${lobbyPlayersMarkup(room, uid)}
      </ul>
    </section>
    </div>
    <div class="lobby-controls">

    ${settingsBlockMarkup(room, host)}

    <div class="lobby-actions" id="lobby-actions">
      ${host
        ? `<button class="button primary start-button" type="button" data-action="start" ${canStart ? '' : 'disabled'}>${icon('play')}<span>开始</span></button>`
        : `<button class="button ${me?.ready ? 'secondary' : 'primary'} ready-button" type="button" data-action="ready">${me?.ready ? `<span>取消准备</span>${icon('x')}` : `<span>准备</span>${icon('check')}`}</button>`}
      <button class="button secondary lobby-leave-button" type="button" data-action="leave">${icon('log-out')}<span>退出</span></button>
    </div>
    </div>
  </div>`;
}

function roundNumberMarkup(number) {
  return `<span class="record-round-number" aria-label="第 ${escapeHtml(number)} 轮">${escapeHtml(number)}</span>`;
}

export function thoughtPathMarkup(room, compactRounds = false) {
  const players = Array.isArray(room?.players) ? room.players : [];
  const rounds = Array.isArray(room?.history) ? [...room.history] : [];
  if (room?.phase === 'voting' && room.words && !rounds.some((round) => round.n === room.round)) {
    rounds.push({ n: room.round, words: room.words, marks: room.marks || {} });
  }
  if (!rounds.length) return '<p class="path-empty">还没有揭晓的词，完成第一轮后就能看到思考路径。</p>';
  const headings = players.map((player) => `<div class="path-player-heading">${avatarMarkup(player.name || '玩家', 'path-avatar')}<span class="path-name">${escapeHtml(player.name || '玩家')}</span></div>`).join('');
  return `<div class="path-table" style="--path-players:${Math.max(players.length, 1)}"><div class="path-table-header"><span class="path-round-label">轮次</span>${headings}</div><ol class="path-rounds">${rounds.map((round, index) => {
    const answers = players.map((player) => {
      const mark = round.marks?.[player.uid];
      const word = mark === 'empty' ? '[未提交]' : mark === 'invalid' ? '[非法答案]' : round.words?.[player.uid] || '[未参与]';
      return `<span class="path-answer"><strong class="path-word">${escapeHtml(word)}</strong></span>`;
    }).join('');
    const met = round.outcome === 'exact' || round.outcome === 'voted' || (index === rounds.length - 1 && ['exact', 'voted'].includes(room?.outcome));
    return `<li class="path-round-item${met ? ' is-met' : ''}"><span class="path-round-number" aria-label="第 ${escapeHtml(round.n)} 轮">${escapeHtml(String(round.n).padStart(2, '0'))}</span>${answers}</li>`;
  }).join('')}</ol></div>`;
}

export function writingMarkup(state, ui = {}) {
  const { room, uid } = state;
  const players = Array.isArray(room.players) ? room.players : [];
  const me = players.find((player) => player.uid === uid);
  const phase = room.phase;
  const submitted = Boolean(me?.submitted || ui.submitted);
  const voted = Boolean((phase === 'breakVote' ? me?.breakVoted : me?.voted) || ui.voted);
  const ready = Boolean(me?.ready || ui.ready);
  const outcome = room.outcome || room.history?.at(-1)?.outcome;
  const pathAvailable = room.round > 2 || (room.round === 2 && phase !== 'writing');
  const pathButton = pathAvailable ? `<button class="path-open" type="button" data-action="open-path">${icon('route')}<span>思考路径</span></button>` : '';
  const stageProgress = stageProgressMarkup(phase);
  const title = phase === 'writing' ? '各自写下此刻想到的词' : phase === 'voting' ? '这些词想到一起了吗？' : phase === 'breakVote' ? '继续下一轮，还是结束本局？' : phase === 'prepare' ? '准备好，再靠近一点' : phase === 'result' ? (outcome === 'exact' || outcome === 'voted' ? '我们相遇了' : outcome === 'miss' || outcome === 'failed' ? '这一局结束了' : '对局结束') : '等待下一阶段';
  const previousRound = phase === 'writing' && Array.isArray(room.history) ? room.history.find((record) => record.n === room.round - 1) : null;
  const words = phase === 'writing' ? previousRound?.words || {} : room.words || room.history?.at(-1)?.words || {};
  const marks = phase === 'writing' ? previousRound?.marks || {} : room.marks || room.history?.at(-1)?.marks || {};
  const keys = phase === 'writing' ? previousRound?.wordKeys : room.wordKeys || room.history?.at(-1)?.wordKeys;
  const validKeys = players.map((player) => {
    const word = words[player.uid];
    if (marks[player.uid] === 'empty' || marks[player.uid] === 'invalid' || typeof word !== 'string' || !word) return null;
    return keys?.[player.uid] ?? word.normalize('NFC').replace(/[！-～]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xFEE0)).replace(/\s/gu, '').toLowerCase();
  });
  const counts = new Map();
  for (const key of validKeys) if (key) counts.set(key, (counts.get(key) || 0) + 1);
  const allMatch = players.length > 1 && validKeys.every((key) => key && key === validKeys[0]);
  const wordCards = players.map((player, index) => {
    const mark = marks[player.uid];
    const value = mark === 'invalid' ? '[非法答案]' : mark === 'empty' ? '[未提交]' : (typeof words[player.uid] === 'string' && words[player.uid] ? words[player.uid] : '[未提交]');
    const duplicate = !allMatch && validKeys[index] && counts.get(validKeys[index]) > 1;
    return wordCardMarkup(player, value, duplicate);
  }).join('');
  const statuses = players.map((player) => {
    const mine = player.uid === uid;
    const complete = phase === 'writing' ? (player.submitted || (mine && ui.submitted)) : phase === 'voting' ? (player.voted || (mine && ui.voted)) : phase === 'breakVote' ? (player.breakVoted || (mine && ui.voted)) : (player.ready || (mine && ui.ready));
    const statusKey = player.connected === false ? 'away' : complete ? 'done' : phase === 'writing' && (player.typing || (mine && ui.draft)) ? 'active' : 'waiting';
    const status = statusKey === 'away' ? '连接中断' : phase === 'writing' ? ({ done: '已提交', active: '正在输入', waiting: '未开始' }[statusKey]) : ['voting', 'breakVote'].includes(phase) ? (complete ? '已投票' : '未投票') : (complete ? '已准备' : '未准备');
    return gameStatusItemMarkup(player, statusKey, status, player.uid === uid);
  }).join('');
  const statusBlock = `<section class="surface-block game-status-block"><div class="section-heading"><h2>玩家状态</h2></div><ul class="game-status-list"${phase === 'writing' ? ' id="game-status"' : ''}>${statuses}</ul></section>`;
  return `<div class="page writing-page" data-screen="${escapeHtml(phase)}" data-room="${escapeHtml(room.code || '')}" data-round="${escapeHtml(room.round ?? '')}">
    <div class="game-info">
    <section class="writing-stage">
      <div class="stage-meta"><span class="stage-round">第 ${escapeHtml(room.round ?? '–')} / ${escapeHtml(room.maxRounds ?? '–')} 轮</span><nav class="stage-progress" aria-label="对局阶段">${stageProgress}</nav>${roomCodeMarkup(room.code || '–', 'stage-room')}</div>
      <div class="stage-content">
        <div class="stage-copy">
          <h1>${title}</h1>
          <p>${phase === 'writing' ? '词语会在所有人提交后揭晓' : phase === 'voting' ? '5 秒内同时投票，超时视为否' : phase === 'breakVote' ? '至少半数选择玩崩了，本局结束且不保存记录；未投票视为继续' : phase === 'prepare' ? '全员准备或倒计时结束后进入下一轮' : '感谢一起游玩'}</p>
          ${phase === 'prepare' ? '<p id="prepare-grace-hint" class="prepare-grace-hint" role="status" hidden>有人掉线，多等一会 · 本次准备额外增加 10 秒</p>' : ''}
        </div>
        ${phase !== 'result' ? `<div class="writing-clock" role="timer" aria-live="off">${icon('clock')}<span id="countdown">–</span></div>` : ''}
      </div>
      <div id="current-theme" class="stage-theme">${themeMarkup(room)}</div>
    </section>
    ${['writing', 'voting', 'prepare', 'breakVote'].includes(phase) ? statusBlock : ''}
    <button class="button secondary game-wide game-leave" type="button" data-action="leave">${icon('log-out')}<span>退出房间</span></button>
    </div>
    <div class="game-controls">
    ${phase === 'writing' ? `<div id="previous-words">${previousRound ? `<section class="surface-block"><div class="section-heading"><h2>上一轮的词</h2>${pathButton}</div><ul class="word-grid">${wordCards}</ul></section>` : ''}</div>` : ''}
    ${phase === 'writing' ? `<form id="word-form" class="surface-block game-form"><label for="word-input">你的词</label><input id="word-input" class="input" value="${escapeHtml(ui.draft || '')}" autocomplete="off" spellcheck="false" placeholder="输入 1–12 个汉字、字母或数字" ${submitted ? 'disabled' : ''}><p class="game-hint">可使用空格；超时将提交输入框中的内容</p><button class="button primary" type="submit" ${submitted ? 'disabled' : ''}><span>${submitted ? '已提交，等待其他玩家' : '提交'}</span>${icon('check')}</button></form>` : ''}
    ${phase === 'voting' || phase === 'prepare' || phase === 'breakVote' || phase === 'result' ? `<section class="surface-block"><div class="section-heading"><h2>本轮的词</h2>${pathButton}</div><ul class="word-grid">${wordCards}</ul></section>` : ''}
    ${phase === 'voting' ? `<div class="game-actions"><button class="button primary" type="button" data-action="vote-yes" ${voted ? 'disabled' : ''}><span>是</span>${icon('check')}</button><button class="button secondary" type="button" data-action="vote-no" ${voted ? 'disabled' : ''}><span>否</span>${icon('x')}</button></div><p class="game-hint game-center">${voted ? '已投票，等待揭晓' : '投票期间不会显示其他人的选择'}</p>` : ''}
    ${phase === 'prepare' ? `<button class="button primary game-wide" type="button" data-action="game-ready" ${ready ? 'disabled' : ''}><span>${ready ? '已准备，等待其他玩家' : '准备下一轮'}</span>${icon('check')}</button>` : ''}
    ${phase === 'breakVote' ? `<div class="game-actions"><button class="button primary" type="button" data-action="break-no" ${voted ? 'disabled' : ''}>${icon('arrow-right')}<span>下一轮</span></button><button class="button primary" type="button" data-action="break-yes" ${voted ? 'disabled' : ''}><span>玩崩了</span>${icon('x')}</button></div><p class="game-hint game-center">${voted ? '已选择，结果确定或倒计时结束后揭晓' : '选择提交后不可更改；结果确定后提前结束'}</p>` : ''}
    </div>
  </div>`;
}

function wordCardMarkup(player, value, duplicate = false) {
  const seat = Number.isInteger(player.seat) && player.seat >= 0 && player.seat < 8 ? player.seat : 0;
  // 已注销玩家的词会被剥离，这里留一条斜杠占位，不显示任何原文。
  const hidden = value === undefined || value === null;
  const shown = hidden ? '/' : String(value);
  return `<li class="word-card previous-word-card" style="--player:var(--player-${seat});--card-color:var(--card-player-${seat})"><div class="previous-word-player">${avatarMarkup(player.name || '玩家', 'previous-word-avatar', { deleted: Boolean(player.deleted) })}<span>${escapeHtml(player.name || '玩家')}</span></div><strong class="${duplicate ? 'word-duplicate' : ''}${hidden ? ' word-erased' : ''}">${escapeHtml(shown)}</strong></li>`;
}

function gameStatusItemMarkup(player, statusKey, status, mine) {
  return `<li class="game-status status-${statusKey}"><span class="game-status-name">${avatarMarkup(player.name || '玩家', 'game-status-avatar')}<span>${escapeHtml(player.name || '玩家')}${mine ? '（你）' : ''}</span></span><span class="ready-state">${icon({ waiting: 'clock', active: 'pen-line', done: 'check', away: 'log-out' }[statusKey], 'game-status-icon')}<span>${status}</span></span></li>`;
}

const RESULT_LINES = {
  exact: ['这次想到一块了', '答案，终于一致了', '默契刚好对上', '不同的思路，同一个答案', '这一轮，心有灵犀', '这次，答案对上了'],
  voted: ['这份默契，大家认可', '词不同，想法很接近', '这一轮，大家都点头', '换个说法，也是同一种想法'],
  none: ['这局各有各的想法', '答案不同，过程也有意思', '这次还差一点默契', '先把这些灵感留在这里']
};

// 'played' 只出现在有总分榜的玩法里，第一名值得一句点名祝贺。
const RESULT_CHEERS = [
  (name) => `${name}，这一局赢得漂亮`,
  (name) => `恭喜 ${name} 拿下这一局`,
  (name) => `这一局属于 ${name}`,
  (name) => `${name} 笑到了最后`,
  (name) => `${name} 一路领先，收下这一局`,
  (name) => `这一局，${name} 站到了最前面`
];

// 并列第一时不挑称呼，两个人一起写进同一句。
const RESULT_TIE_CHEERS = [
  (names) => `恭喜 ${names} 并列第一`,
  (names) => `${names} 并列榜首，这一局难分高下`,
  (names) => `这一局，${names} 并排站上第一`
];

// 没有总分可排（例如全员 0 分）时不点名，只说这一局跑完了。
const PLAYED_LINES = ['这一局跑完了', '一轮一轮，走到了最后', '这一局，答案都留在这里'];

// 同一局的文案只由房号与对局记录决定：结算期间状态再更新也不会跳变。
function resultLine(room, lines) {
  const seed = `${room.code}:${JSON.stringify(room.history || [])}`;
  let hash = 0;
  for (const ch of seed) hash = (Math.imul(hash, 31) + ch.codePointAt(0)) >>> 0;
  return lines[hash % lines.length];
}

// 有总分榜的玩法按总分取第一名；并列时并列的人共享同一句祝贺。
export function resultWinners(room) {
  const players = room?.resultPlayers || room?.players || [];
  const scores = room?.livonym?.scores || {};
  const nameOf = (uid) => players.find((player) => player.uid === uid)?.name || '';
  const ranked = Object.entries(scores)
    .map(([uid, score]) => ({ name: nameOf(uid), score: Number(score) || 0 }))
    .filter((row) => row.name)
    .sort((a, b) => b.score - a.score);
  if (!ranked.length || ranked[0].score <= 0) return [];
  return ranked.filter((row) => row.score === ranked[0].score);
}

// 结算语分两种交付：纯文本直接输出，带名字的句子再把名字交给页面挂头像。
function resultSentence(room) {
  if (room.outcome === 'break') return { text: '本局已结束' };
  if (room.outcome === 'played') {
    const names = resultWinners(room).map((row) => row.name);
    if (!names.length) return { text: resultLine(room, PLAYED_LINES) };
    return { build: resultLine(room, names.length === 1 ? RESULT_CHEERS : RESULT_TIE_CHEERS), names };
  }
  const lines = room.outcome === 'exact' && room.history?.length === 1
    ? ['第一轮就想到一块了', '开局就有默契', '一个词，刚好想到一起']
    : RESULT_LINES[room.outcome] || RESULT_LINES.none;
  return { text: resultLine(room, lines) };
}

// 并列第一时名字用顿号与「和」串起来。
function joinNames(names, wrap = (name) => name) {
  const parts = names.map(wrap);
  return parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join('、')}和${parts.at(-1)}`;
}

export function resultTitle(room) {
  const sentence = resultSentence(room);
  return sentence.build ? sentence.build(joinNames(sentence.names)) : sentence.text;
}

// 结算页标题：句中的名字带头像，与总分榜、逐棒回顾里的身份块同一套。
export function resultTitleMarkup(room) {
  const sentence = resultSentence(room);
  if (!sentence.build) return escapeHtml(sentence.text);
  return sentence.build(joinNames(sentence.names, (name) => playerIdentityMarkup(name, { className: 'result-title-name' })));
}

// 结算页的结果说明。
export function resultSummary(room) {
  const history = Array.isArray(room?.history) ? room.history : [];
  if (room?.outcome === 'break') return '崩局投票通过，本局记录不会保存。';
  if (room?.outcome === 'played') return `共 ${history.length} 棒，按总分排名。`;
  if (room?.outcome === 'exact' || room?.outcome === 'voted') {
    const round = history.at(-1)?.n ?? room?.round;
    return `第 ${round} 轮${room.outcome === 'voted' ? '投票达成一致' : '写出同一个词'}`;
  }
  return `走过 ${history.length} 轮，留下了这些不同的想法。`;
}

function voteRecordsMarkup(history, players) {
  const choiceMarkup = (player, votes, choices, isBreak) => {
    const value = choices?.[player.uid];
    const legacy = !choices && votes && Object.hasOwn(votes, player.uid) ? votes[player.uid] : undefined;
    const key = value === 'yes' || legacy === true ? 'yes' : value === 'no' ? 'no' : value === 'timeout' ? 'timeout' : legacy === false ? 'unknown' : 'absent';
    const labels = isBreak ? { yes: '玩崩了', no: '下一轮', timeout: '超时', unknown: '拒绝 / 超时', absent: '未参与' }
      : { yes: '同意', no: '拒绝', timeout: '超时', unknown: '拒绝 / 超时', absent: '未参与' };
    const symbol = { yes: 'check', no: 'x', timeout: 'clock', unknown: 'circle-help', absent: 'circle-help' }[key];
    return `<li><span class="result-vote-player">${avatarMarkup(player.name || player.uid, 'result-vote-avatar')}<span>${escapeHtml(player.name || player.uid)}</span></span><strong class="result-vote-choice is-${key}">${icon(symbol)}<span>${labels[key]}</span></strong></li>`;
  };
  const entry = (round, isBreak = false) => {
    const data = isBreak ? round.breakVote : round;
    const exact = !isBreak && round.outcome === 'exact';
    const passed = isBreak ? data.passed : round.outcome === 'voted';
    const result = exact ? '无需投票' : passed ? '通过' : '未通过';
    const symbol = exact ? 'check' : passed ? 'check' : 'x';
    const rows = !exact && (data.votes || data.voteChoices || data.choices)
      ? `<ul class="result-vote-list">${players.map((player) => choiceMarkup(player, data.votes, isBreak ? data.choices : data.voteChoices, isBreak)).join('')}</ul>` : '';
    return `<li class="result-vote-round"><div class="result-vote-heading"><h3>${roundNumberMarkup(round.n)}${isBreak ? '<span class="result-break-label">崩局投票</span>' : ''}</h3><span class="result-vote-outcome ${passed ? 'is-passed' : ''}">${icon(symbol)}<span>${result}</span></span></div>${rows}</li>`;
  };
  return history.map((round) => entry(round) + (round.breakVote ? entry(round, true) : '')).join('');
}

function resultPathMarkup(room, { open = false } = {}) {
  const path = thoughtPathMarkup(room, true);
  return `<details class="surface-block result-votes result-path"${open ? ' open' : ''}><summary><span class="result-votes-label">${icon('route', 'result-votes-title-icon')}<span>完整词路径</span></span>${icon('chevron-down', 'result-votes-icon')}</summary><div class="result-path-content">${path}</div></details>`;
}

export function rematchMarkup(state) {
  const { room, uid } = state;
  const voting = ['result', 'rematch'].includes(room.phase) && room.rematchDeadline != null;
  const eligible = room.rematchEligibleUids || [];
  const choices = room.rematchVotes || {};
  const mine = choices[uid];
  const canChoose = !voting || eligible.includes(uid);
  const roomChosen = eligible.some((id) => choices[id] === 'room');
  const resultPlayers = room.resultPlayers || room.players || [];
  const statusPlayers = [...resultPlayers, ...(room.players || []).filter((player) => !resultPlayers.some((item) => item.uid === player.uid))];
  const statuses = statusPlayers.map((snapshot) => {
    const player = (room.players || []).find((item) => item.uid === snapshot.uid);
    const choice = choices[snapshot.uid];
    const left = !player || !eligible.includes(snapshot.uid);
    const away = !left && player.connected === false;
    const label = choice === 'rematch' ? '重赛' : choice === 'room' ? '回房间' : '选择中';
    const statusKey = left || away ? 'away' : choice ? 'done' : 'waiting';
    const status = left ? '已离开' : away ? `连接中断${choice ? ` · 已选${label}` : ''}` : choice ? `已选${label}` : label;
    const name = player?.name || snapshot.name || snapshot.uid;
    return `<li class="game-status status-${statusKey}"><span class="game-status-name">${avatarMarkup(name, 'game-status-avatar')}<span>${escapeHtml(name)}${snapshot.uid === uid ? '（你）' : ''}</span></span><span class="ready-state">${icon({ waiting: 'clock', done: 'check', away: 'log-out' }[statusKey], 'game-status-icon')}<span>${escapeHtml(status)}</span></span></li>`;
  }).join('');
  return `<section class="surface-block result-rematch" aria-label="下一步"><div class="section-heading"><h2>${icon('rotate-ccw')}<span>下一步</span></h2>${voting ? '<span class="rematch-clock" role="timer" aria-live="off">'+icon('clock')+'<span id="countdown">30 秒</span></span>' : ''}</div>
    <p class="rematch-description">全员重赛，按当前配置直接开下一局；想调整配置就回房间。</p>
    ${voting ? `<div class="result-player-status" aria-live="polite"><div class="section-heading"><h3>玩家状态</h3></div><ul class="game-status-list">${statuses}</ul></div>` : ''}
    <div class="rematch-actions">
      <button class="button primary" type="button" data-action="rematch-yes" ${!canChoose || roomChosen || mine === 'rematch' ? 'disabled' : ''}>${icon('play')}<span>${mine === 'rematch' ? '已选重赛' : '重赛'}</span></button>
      <button class="button secondary" type="button" data-action="rematch-room" ${!canChoose || mine === 'room' ? 'disabled' : ''}>${icon('users')}<span>${mine === 'room' ? '已选回房间' : '回房间'}</span></button>
      <button class="rematch-home" type="button" data-action="leave">${icon('arrow-right')}<span>回主页</span></button>
    </div>
    <p class="rematch-footnote">原结算名单至少 2 人全员在线并选择重赛才直接开局；有人选择回房间，或到期仍有人未选择或断线时，已选择且在线的玩家回房间，其余玩家退出。</p></section>`;
}

export function resultMarkup(state) {
  const { room, uid } = state;
  if (room.phase === 'interrupted') return `<div class="page result-page" data-screen="interrupted" data-room="${escapeHtml(room.code)}">
    ${headingMarkup('section', 'result-heading', '<h1>本局已中断</h1><p>房间只剩一位玩家，本局不会记录。</p>', headingMetaMarkup(room.code, room))}
    <section class="surface-block result-rematch" aria-label="下一步"><div class="section-heading"><h2>${icon('rotate-ccw')}<span>下一步</span></h2></div><p class="rematch-description">回房间邀请朋友重新开始，或回主页退出房间。</p><div class="rematch-actions">
      <button class="button primary" type="button" data-action="rematch-room">${icon('users')}<span>回房间</span></button>
      <button class="button secondary" type="button" data-action="leave">${icon('arrow-right')}<span>回主页</span></button>
    </div></section></div>`;
  if (room.mode === 'livonym') return livonymResultMarkup(state);
  const players = room.resultPlayers || room.players || [];
  const history = room.history || [];
  const voting = room.phase === 'rematch';
  const voteRecords = voteRecordsMarkup(history, players);
  return `<div class="page result-page" data-screen="${voting ? 'rematch' : 'result'}" data-room="${escapeHtml(room.code)}">
    ${headingMarkup('section', 'result-heading', `<h1>${resultTitleMarkup(room)}</h1><p>${escapeHtml(resultSummary(room))}</p>`, headingMetaMarkup(room.code, room))}
    <div class="result-aside">
      <div id="result-rematch" class="result-rematch-group">${rematchMarkup(state)}</div>
      <details class="surface-block result-votes"><summary><span class="result-votes-label">${icon('vote', 'result-votes-title-icon')}<span>投票记录</span></span>${icon('chevron-down', 'result-votes-icon')}</summary><ol class="result-vote-records">${voteRecords}</ol></details>
    </div>
    <div class="result-main">${resultPathMarkup({ ...room, players }, { open: true })}</div>
  </div>`;
}

const detailPad = (value) => String(value).padStart(2, '0');

function detailDayLabel(date) {
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;
}

function detailClockLabel(date) {
  return `${detailPad(date.getHours())}:${detailPad(date.getMinutes())}`;
}

// 起止时间同一自然日只写一次日期；跨天两端都带日期。
function detailRangeLabel(startedAt, endedAt) {
  const start = new Date(startedAt);
  if (!Number.isFinite(start.getTime())) return '–';
  const begin = `${detailDayLabel(start)} ${detailClockLabel(start)}`;
  const end = new Date(endedAt);
  if (!Number.isFinite(end.getTime())) return begin;
  const sameDay = start.getFullYear() === end.getFullYear()
    && start.getMonth() === end.getMonth()
    && start.getDate() === end.getDate();
  return sameDay ? `${begin} – ${detailClockLabel(end)}` : `${begin} – ${detailDayLabel(end)} ${detailClockLabel(end)}`;
}

function detailDurationLabel(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor(total % 3600 / 60);
  if (hours) return `${hours} 小时 ${minutes} 分`;
  if (minutes) return `${minutes} 分 ${total % 60} 秒`;
  return `${total} 秒`;
}

// 详情页标题下的条目带：起止时间、轮次、房号、模式各格，共用一个描边底板，格内文字居中。
function matchFactsMarkup(match) {
  const theme = match.themeName || '';
  const timed = Number.isFinite(match.startedAt) && Number.isFinite(match.endedAt);
  const cells = [
    { icon: 'clock', label: '起止时间', value: detailRangeLabel(match.startedAt, match.endedAt), note: timed ? `用时 ${detailDurationLabel(match.endedAt - match.startedAt)}` : '' },
    { icon: 'rotate-ccw', label: '轮次', value: `${Number(match.totalRounds) || 0} / ${Number(match.maxRounds) || 0}` },
    { icon: 'door-open', label: '房号', value: match.roomCode || '–' },
    { icon: 'sparkles', label: '模式', value: theme ? '主题' : '自由', note: theme },
  ];
  return `<dl class="match-detail-facts">${cells.map((cell) => `<div><dt>${icon(cell.icon)}<span>${escapeHtml(cell.label)}</span></dt><dd>${escapeHtml(cell.value)}${cell.note ? `<span class="match-fact-note">${escapeHtml(cell.note)}</span>` : ''}</dd></div>`).join('')}</dl>`;
}

// 历史详情把库里的一局还原成词路径共用的房间形状。
export function matchRoom(match) {
  return { ...match, code: match.roomCode, history: match.history || match.rounds, resultPlayers: match.players };
}

export function matchDetailMarkup(detail, query = {}) {
  const back = `<a class="button secondary privacy-back" href="${escapeHtml(historyHref(query))}">${icon('arrow-right')}<span>返回对局记录</span></a>`;
  if (!detail || detail.error) return `<div class="page match-detail-page" data-screen="match-detail">${back}<h1>对局详情</h1><p role="status">${escapeHtml(detail?.error || '正在读取对局…')}</p></div>`;
  const match = detail.match;
  const room = matchRoom(match);
  const livonym = match.mode === 'livonym';
  const outcome = livonym ? `共 ${match.totalRounds} 棒结束`
    : match.outcome === 'none' ? `打满 ${match.totalRounds} 轮未相遇` : `第 ${match.convergedRound} 轮${match.outcome === 'voted' ? '投票' : ''}相遇`;
  return `<div class="page match-detail-page" data-screen="match-detail">${back}
    ${headingMarkup('header', 'match-detail-heading', `<h1>${escapeHtml(outcome)}</h1>${matchFactsMarkup(match)}`, '')}
    <div class="match-detail-main">
    ${livonym ? livonymReviewBlock(room, true) : resultPathMarkup(room, { open: false })}
    </div><div class="match-detail-aside">
    <section class="surface-block"><div class="section-heading"><h2>${icon('users')}<span>同局玩家</span></h2></div><ul class="match-detail-players">${match.players.map((player) => (player.deleted
      ? `<li>${avatarMarkup(player.name, '', { deleted: true })}<div><strong>${escapeHtml(player.name)}</strong><span>已注销</span></div></li>`
      : `<li>${avatarMarkup(player.name)}<div><strong>${escapeHtml(player.name)}</strong><span>UID：${escapeHtml(player.uid)}</span></div></li>`)).join('')}</ul></section>
    ${livonym ? '' : `<details class="surface-block result-votes"><summary><span class="result-votes-label">${icon('vote', 'result-votes-title-icon')}<span>逐轮投票记录</span></span>${icon('chevron-down', 'result-votes-icon')}</summary><ol class="result-vote-records">${voteRecordsMarkup(room.history, match.players)}</ol></details>`}
    </div>
  </div>`;
}

// ── 即时竞猜 ──

const LIVONYM_STEPS = [
  ['lvIntro', '准备', 'pen-line'],
  ['lvPlay', '描述 / 抢猜', 'play'],
  ['lvScore', '结算', 'check']
];

function livonymStepsMarkup(phase) {
  return LIVONYM_STEPS.map(([step, label, glyph]) => `<span class="stage-step${phase === step ? ' is-current' : ''}"${phase === step ? ' aria-current="step"' : ''}>${icon(glyph)}<span class="stage-step-label">${label}</span></span>`)
    .join('<span class="stage-step-divider" aria-hidden="true">·</span>');
}

// 本轮得分原因，与 server/livonym.js 的计分规则一一对应。
export function livonymRoundReason(modeDetails) {
  if (!modeDetails) return '';
  const guessedCount = Object.keys(modeDetails.guesses || {}).length;
  if (!guessedCount) return '没人猜中';
  if (guessedCount >= (modeDetails.guesserCount ?? 0)) return '全都猜中了';
  return `${guessedCount} 人猜中`;
}

// 前三名的金银铜：122 按猜中名次，123 按总分次序，两处共用同一套类名。
export function livonymMedalClass(rank) {
  return rank === 1 ? ' is-first' : rank === 2 ? ' is-second' : rank === 3 ? ' is-third' : '';
}

// 本轮天花板：竞猜者第一名 3 分；出题人每有一人猜中 1 分、全员猜中归零，8 人局最高 6 分。取两者较大值。
export function livonymRoundMax(guesserCount = 0) {
  return Math.max(3, Math.max(0, (guesserCount || 0) - 1));
}

// 加分字样的强度只跟「本轮天花板」的比例走：拿满时最大最亮，拿一半就减半。
export function livonymGainAttrs(points, roundMax) {
  const value = Math.max(0, points || 0);
  const ratio = roundMax > 0 ? Math.min(1, value / roundMax) : 0;
  return `data-points="${value}" style="--gain:${ratio.toFixed(2)};--gain-pct:${Math.round(35 + 65 * ratio)}%;--gain-glow:${Math.round(50 * ratio)}%"`;
}

// 玩家身份块：头像 + 名字 + 大厅同款标签。122 的猜中列表、123 的排行与逐棒回顾共用一份。
// 头像尺寸跟着名字的字号走（1em），换到结算页或历史详情时不会忽然变成另一种比例。
function playerIdentityMarkup(name, { className = '', role = '', mine = false } = {}) {
  const tags = `${mine ? '<span class="badge me-label">你</span>' : ''}${role ? `<span class="badge me-label">${escapeHtml(role)}</span>` : ''}`;
  return `<span class="player-identity${className ? ` ${className}` : ''}">${avatarMarkup(name || '玩家', 'player-identity-avatar')}<span class="player-identity-name">${escapeHtml(name || '玩家')}</span>${tags}</span>`;
}

// 已猜中的按名次排在前，未猜中的按座位顺序留空态。
// 一行的排布：名次 | 身份（头像 + 名字 + 标签）| 用时（制表位对齐）| 弹性留白 | 本轮得分。
export function livonymGuessedRowsMarkup(livonym, uid) {
  const guessed = livonym.guessed || [];
  const taken = new Set(guessed.map((item) => item.uid));
  const pending = (livonym.guessers || []).filter((player) => !taken.has(player.uid));
  const roundMax = livonymRoundMax(livonym.guesserCount);
  const row = ({ playerUid, name, order, atMs, points }) => `<li class="livonym-guessed-item${order ? ` is-guessed${livonymMedalClass(order)}` : ' is-pending'}" data-uid="${escapeHtml(playerUid)}"><span class="livonym-guessed-rank">${order ? escapeHtml(order) : '–'}</span>${playerIdentityMarkup(name || playerUid, { className: 'livonym-guessed-name', mine: playerUid === uid })}<span class="livonym-guessed-time">${order ? `${(Math.max(0, atMs) / 1000).toFixed(1)}s` : '–'}</span><span class="livonym-gain" ${livonymGainAttrs(order ? points : 0, roundMax)}>+${order ? points || 0 : 0}</span></li>`;
  return [
    ...guessed.map((item) => row({ playerUid: item.uid, name: item.name, order: item.order, atMs: item.atMs, points: item.points })),
    ...pending.map((player) => row({ playerUid: player.uid, name: player.name, order: 0, atMs: 0, points: 0 }))
  ].join('');
}

function livonymGuessedMarkup(livonym, uid) {
  const guessed = livonym.guessed || [];
  const rows = livonymGuessedRowsMarkup(livonym, uid);
  return `<section class="surface-block livonym-guessed-block" aria-label="猜中情况">
    <div class="section-heading"><h2>${icon('users')}<span>已猜中 <span id="livonym-guessed-count">${guessed.length}</span> / 共 ${livonym.guesserCount ?? 0} 人</span></h2></div>
    <p class="game-hint">每有一人猜中 +1 分，全部猜中则本轮 0 分</p>
    <ol id="livonym-guessed" class="livonym-guessed-list">${rows}</ol>
  </section>`;
}

// 秘密词块：121 与 122 共用，只有出题人看得到词，其他人看到遮起来的占位。
// 123 揭晓时复用同一张卡，但这时词已经公开，右上角不再挂「只有出题人看得到」。
function livonymSecretBlock(livonym, isDescriber, { revealed = false } = {}) {
  const heading = isDescriber && !revealed ? '你的秘密词' : '本轮秘密词';
  const tag = revealed ? '' : isDescriber ? '只有你看得到' : '只有出题人看得到';
  const visible = revealed || isDescriber;
  const body = visible
    ? `<p id="livonym-secret" class="livonym-secret">${escapeHtml(livonym.secret || '')}</p>`
    : '<p class="livonym-secret is-locked" aria-hidden="true">••••</p>';
  return `<section class="surface-block livonym-secret-block"${revealed ? ' data-revealed="true"' : ''}>
    <div class="section-heading"><h2>${icon('lightbulb')}<span>${heading}</span></h2>${tag ? `<span class="readonly-tag">${tag}</span>` : ''}</div>
    ${body}
  </section>`;
}

function livonymDescriberPanel(livonym, ui) {
  const describeText = ui.describeText || '';
  return `${livonymSecretBlock(livonym, true)}
  <form id="describe-form" class="surface-block game-form livonym-describe-form">
    <label for="describe-input">你的描述</label>
    <textarea id="describe-input" class="input livonym-describe-input" rows="1" autocomplete="off" spellcheck="false" placeholder="打字即直播，不用提交…" aria-describedby="describe-hint">${escapeHtml(describeText)}</textarea>
    <div class="game-hint describe-hint" id="describe-hint"><span class="describe-hint-text">写出谜底会被拦下；可以分行。</span><output id="describe-count" class="describe-count">${[...describeText].length}/${DESCRIBE_LIMIT}</output></div>
  </form>`;
}

function livonymGuesserPanel(livonym, ui) {
  const text = ui.streamText ?? livonym.streamText ?? '';
  const order = ui.guessedOrder || 0;
  // 冷却与答对是同一张卡片的两种状态：冷却时整卡从右往左退成进度条，答对后整卡呼吸绿光。
  const cooldownUntil = Number(ui.guessCooldownUntil) || 0;
  const cooling = !order && cooldownUntil > Date.now();
  const cooldownStyle = cooling ? ` style="--guess-cooldown:${Math.max(0, cooldownUntil - Date.now())}ms"` : '';
  const formState = order ? ' is-correct' : cooling ? ' is-cooling' : '';
  return `<section class="surface-block livonym-stream-block">
    <div class="section-heading"><h2>${icon('pen-line')}<span class="livonym-stream-author">${playerIdentityMarkup(livonym.describerName || '出题人', { className: 'livonym-stream-author-name' })}<span> 的描述</span></span></h2></div>
    <p id="livonym-stream" class="livonym-stream" role="status" aria-live="polite"><span class="livonym-stream-body"><span id="livonym-stream-text">${escapeHtml(text)}</span><i class="livonym-caret" aria-hidden="true"></i></span></p>
  </section>
  <form id="guess-form" class="surface-block game-form guess-form${formState}"${cooldownStyle}>
    <label for="guess-input">你的答案</label>
    <input id="guess-input" class="input" value="${escapeHtml(ui.guessText || '')}" autocomplete="off" spellcheck="false" placeholder="输入 1–12 个汉字、字母或数字"${order || cooling ? ' disabled' : ''}>
    <p class="game-hint" id="guess-hint" role="status">${order ? `第 ${order} 个猜中，本轮 +${ui.guessPoints || 0} 分` : '猜错不扣分，1.5 秒后可以再猜'}</p>
    <button class="button primary${order ? ' is-correct' : ''}" type="submit"${order || cooling ? ' disabled' : ''}>${order ? `${icon('check')}<span>正确！</span>` : `<span>抢答</span>${icon('check')}`}</button>
  </form>`;
}

// 一棒的结算行：名次 | 身份（头像 + 名字 + 大厅同款标签）| 总分（右上角挂本轮加分）。
// 122 的实时面板与逐棒回顾共用同一套行；prevRankOf 只有实时面板传，结算动画据此把每一行从旧名次滑到新名次。
function livonymScoreRowsMarkup({ ids, totals, details, uid, nameOf, prevRankOf }) {
  const points = details.points || {};
  const roundMax = livonymRoundMax(details.guesserCount);
  return ids
    .map((id) => ({ id, total: totals[id] || 0, round: points[id] || 0 }))
    .sort((a, b) => b.total - a.total)
    .map((row, index) => `<li class="livonym-score-row${row.id === details.describerUid ? ' is-describer' : ''}${livonymMedalClass(index + 1)}" data-uid="${escapeHtml(row.id)}"${prevRankOf ? ` data-prev-rank="${prevRankOf.get(row.id) ?? index + 1}"` : ''}>
      <span class="livonym-score-rank">${index + 1}</span>
      ${playerIdentityMarkup(nameOf(row.id), { className: 'livonym-score-name', role: row.id === details.describerUid ? '出题' : '', mine: row.id === uid })}
      <span class="livonym-score-total"><strong>${row.total}</strong><span class="livonym-gain" ${livonymGainAttrs(row.round, roundMax)}>+${row.round}</span></span>
    </li>`).join('');
}

// 一棒的「本轮结算」卡片：得分原因、本轮满分与这张排行。秘密词改由下方共用的秘密词卡显示。
// live 为真时补上标题行与实时更新要用的节点 id。
function livonymScoreCardMarkup({ details, rows, live = false }) {
  const roundMax = livonymRoundMax(details.guesserCount);
  const heading = live
    ? `<div class="section-heading"><h2>${icon('sparkles')}<span>本轮结算</span></h2><span class="readonly-tag">${escapeHtml(livonymRoundReason(details))}</span></div>
    `
    : '';
  return `${heading}<p class="game-hint">本轮满分 ${roundMax} 分（在线竞猜者 ${details.guesserCount ?? 0} 人）${details.aborted ? ' · 本轮中止' : ''}</p>
    <ul${live ? ' id="livonym-scores"' : ''} class="livonym-score-list">${rows}</ul>`;
}

function livonymScorePanel(room, uid) {
  const livonym = room.livonym || {};
  const details = room.history?.at(-1)?.modeDetails || {};
  const points = details.points || {};
  const scores = livonym.scores || {};
  const players = room.players || [];
  const ids = (livonym.order || []).filter((id) => players.some((player) => player.uid === id));
  const nameOf = (id) => players.find((player) => player.uid === id)?.name || id;
  // 上一轮名次：总分减掉本轮得分后重排，列表据此播位移动画。
  const prevRankOf = new Map(ids
    .map((id) => ({ id, total: (scores[id] || 0) - (points[id] || 0) }))
    .sort((a, b) => b.total - a.total)
    .map((row, index) => [row.id, index + 1]));
  const rows = livonymScoreRowsMarkup({ ids, totals: scores, details, uid, nameOf, prevRankOf });
  return `<section class="surface-block livonym-score-block">
    ${livonymScoreCardMarkup({ details, rows, live: true })}
  </section>`;
}

export function livonymMarkup(state, ui = {}) {
  const { room, uid } = state;
  const livonym = room.livonym || {
    order: [], index: 0, totalRounds: 0, guessed: [], guessers: [], scores: {}, guesserCount: 0, streamText: '', secret: null
  };
  const phase = room.phase;
  const isDescriber = livonym.describerUid === uid;
  const totalRounds = livonym.totalRounds || 0;
  const round = Math.min(Math.max(1, totalRounds), (livonym.index ?? 0) + 1);
  const isLastRound = totalRounds > 0 && (livonym.index ?? 0) + 1 >= totalRounds;
  const describerName = livonym.describerName || '出题人';
  const title = phase === 'lvIntro' ? (isDescriber ? '轮到你出题' : `${describerName} 正在准备`)
    : phase === 'lvPlay' ? (isDescriber ? '把秘密词描述给他们' : '这是谁的秘密词？')
      : '本轮结算';
  const copy = phase === 'lvIntro' ? (isDescriber ? '看完秘密词，倒计时结束后开始打字。' : '秘密词只发给本轮出题人，描述会实时出现在下面。')
    : phase === 'lvPlay' ? (isDescriber ? '打字即直播，不用提交；别把谜底写出来。' : '想到就直接抢答，越早分越高。')
      : isLastRound ? '最后一棒结算，之后进入本局总结。' : '倒计时结束后交给下一位出题人。';
  // 123 把秘密词从结算卡片里拿出来，复用 121/122 的秘密词卡，放在舞台下方。
  const revealedSecret = phase === 'lvScore'
    ? livonymSecretBlock({ secret: room.history?.at(-1)?.modeDetails?.secret || livonym.secret }, false, { revealed: true })
    : '';
  // 122 的猜中列表属于左列，和舞台一起排在退出按钮之外。
  const guessedBlock = phase === 'lvPlay' ? livonymGuessedMarkup(livonym, uid) : '';
  const main = phase === 'lvScore' ? livonymScorePanel(room, uid)
    : phase === 'lvIntro' ? livonymSecretBlock(livonym, isDescriber)
      : isDescriber ? livonymDescriberPanel(livonym, ui)
        : livonymGuesserPanel(livonym, ui);
  return `<div class="page writing-page livonym-page" data-role="${isDescriber ? 'describer' : 'guesser'}" data-screen="${escapeHtml(phase)}" data-room="${escapeHtml(room.code || '')}" data-round="${escapeHtml(room.round ?? '')}">
    <div class="game-info">
    <section class="writing-stage">
      <div class="stage-meta"><span class="stage-round">第 ${escapeHtml(round)} / ${escapeHtml(totalRounds)} 棒</span><nav class="stage-progress" aria-label="对局阶段">${stageProgressMarkup(phase)}</nav>${roomCodeMarkup(room.code || '–', 'stage-room')}</div>
      <div class="stage-content">
        <div class="stage-copy"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(copy)}</p></div>
        <div class="writing-clock" role="timer" aria-live="off">${icon('clock')}<span id="countdown">–</span></div>
      </div>
    </section>
    ${revealedSecret}
    ${guessedBlock}
    </div>
    <div class="game-controls">${main}
    <button class="button secondary game-wide game-leave" type="button" data-action="leave">${icon('log-out')}<span>退出房间</span></button>
    </div>
  </div>`;
}

// 结算：总分榜、称号与逐棒回顾（秘密词 + 猜中顺序 + 本轮得分）。
export function livonymResultMarkup(state) {
  const { room, uid } = state;
  const livonym = room.livonym || {};
  const scores = livonym.scores || {};
  const players = room.resultPlayers || room.players || [];
  const history = room.history || [];
  const names = new Map(players.map((player) => [player.uid, player.name]));
  const nameOf = (id) => names.get(id) || '已离开的玩家';
  const ranked = Object.entries(scores)
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score || String(nameOf(a.id)).localeCompare(String(nameOf(b.id))));
  const rows = ranked.map((row, index) => `<li class="livonym-result-row"><span class="livonym-result-rank">${index + 1}</span>${playerIdentityMarkup(nameOf(row.id), { className: 'livonym-result-name', mine: row.id === uid })}<strong class="livonym-result-score">${row.score}</strong></li>`).join('');

  const guessTotals = {}, describeTotals = {};
  let fastest = null;
  for (const record of history) {
    const details = record.modeDetails;
    if (!details) continue;
    for (const [id, value] of Object.entries(details.points || {})) {
      const bucket = id === details.describerUid ? describeTotals : guessTotals;
      bucket[id] = (bucket[id] || 0) + value;
    }
    for (const [id, item] of Object.entries(details.guesses || {})) {
      if (!fastest || item.atMs < fastest.atMs) fastest = { id, atMs: item.atMs };
    }
  }
  const topOf = (bucket) => Object.entries(bucket).sort((a, b) => b[1] - a[1])[0] || null;
  const badges = [];
  const guessTop = topOf(guessTotals);
  if (guessTop && guessTop[1] > 0) badges.push([{ label: '竞猜王', id: guessTop[0] }, `${guessTop[1]} 分`]);
  const describeTop = topOf(describeTotals);
  if (describeTop && describeTop[1] > 0) badges.push([{ label: '最佳描述', id: describeTop[0] }, `${describeTop[1]} 分`]);
  if (fastest) badges.push([{ label: '神猜', id: fastest.id }, `${(fastest.atMs / 1000).toFixed(1)} 秒`]);

  return `<div class="page result-page livonym-result-page" data-screen="${escapeHtml(room.phase === 'rematch' ? 'rematch' : 'result')}" data-room="${escapeHtml(room.code)}">
    ${headingMarkup('section', 'result-heading', `<h1>${resultTitleMarkup(room)}</h1><p>${escapeHtml(resultSummary(room))}</p>`, headingMetaMarkup(room.code, room))}
    <div class="result-aside">
      <div id="result-rematch" class="result-rematch-group">${rematchMarkup(state)}</div>
    </div>
    <div class="result-main">
      <section class="surface-block livonym-result-board"><div class="section-heading"><h2>${icon('sparkles')}<span>总分</span></h2></div><ol class="livonym-result-list">${rows}</ol>
        ${badges.length ? `<ul class="livonym-badges">${badges.map(([badge, value]) => `<li><span class="livonym-badge-label">${badge.label} · ${playerIdentityMarkup(nameOf(badge.id), { className: 'livonym-badge-name', mine: badge.id === uid })}</span><strong>${escapeHtml(value)}</strong></li>`).join('')}</ul>` : ''}
      </section>
      ${livonymReviewBlock(room, true, uid)}
    </div>
  </div>`;
}

// 逐棒回顾：一棒一页，每页就是那一棒的「本轮结算」卡片。
// 总分按棒累加，和实时面板在当轮拿到的快照一致。
function livonymReviewRounds(room) {
  const players = room.resultPlayers || room.players || [];
  const names = new Map(players.map((player) => [player.uid, player.name]));
  const nameOf = (id) => names.get(id) || '已离开的玩家';
  const seated = players.map((player) => player.uid);
  const totals = {};
  return (room.history || []).map((record, index) => {
    const details = record.modeDetails || {};
    for (const [id, value] of Object.entries(details.points || {})) totals[id] = (totals[id] || 0) + value;
    return { n: record.n ?? index + 1, details, totals: { ...totals }, ids: [...new Set([...seated, ...Object.keys(totals)])], nameOf };
  });
}

export function livonymReviewMarkup(room, uid) {
  const rounds = livonymReviewRounds(room);
  if (!rounds.length) return '<p class="path-empty">这一局没有打完的棒。</p>';
  // 一棒一页，横向 scroll-snap 翻页；翻页器在页上方，与主页介绍那一套相同。
  const pages = rounds.map(({ n, details, totals, ids, nameOf }) => `<div class="livonym-review-page" data-round="${escapeHtml(n)}" role="group" aria-label="第 ${escapeHtml(n)} 棒">${livonymSecretBlock({ secret: details.secret }, false, { revealed: true })}${livonymScoreCardMarkup({ details, rows: livonymScoreRowsMarkup({ ids, totals, details, uid, nameOf }) })}</div>`).join('');
  const pager = rounds.length > 1
    ? `<nav class="livonym-review-pagination" aria-label="逐棒回顾翻页">
        <button type="button" data-review-step="-1" aria-label="上一棒" disabled>${icon('arrow-left')}</button>
        <span class="livonym-review-page-count" aria-live="polite">1 / ${rounds.length}</span>
        <button type="button" data-review-step="1" aria-label="下一棒">${icon('arrow-right')}</button>
      </nav>
      `
    : '';
  return `<div class="livonym-review-carousel">
      ${pager}<div class="livonym-review-pages scrollbars-hidden" role="region" aria-label="逐棒回顾，可滑动翻页" tabindex="0">${pages}</div>
    </div>`;
}

// 结算与历史详情共用的折叠块。
export function livonymReviewBlock(room, open = false, uid) {
  return `<details class="surface-block result-votes livonym-review"${open ? ' open' : ''}><summary><span class="result-votes-label">${icon('route', 'result-votes-title-icon')}<span>逐棒回顾</span></span>${icon('chevron-down', 'result-votes-icon')}</summary>${livonymReviewMarkup(room, uid)}</details>`;
}

// 各玩法英文名都是字形艺术：完整名称由外层提供，艺术字只做视觉。
// 狂意页的模式卡与房间里的模式标签共用同一份字形。
export const wordmarkArt = {
  // 接龙：字组依次接续，不附加链环或挂钩。
  shiritori: '<span class="wm-shiritori" aria-hidden="true"><span class="sh-part" style="--i:0">Shi</span><span class="sh-part" style="--i:1">ri</span><span class="sh-part" style="--i:2">tori</span></span>',
  // 即时竞猜：i 的点发出绿光，整个单词从左至右逐字点亮。
  livonym: `<span class="wm-livonym" aria-hidden="true">${[...'Livonym'].map((letter, i) => `<span class="live-char${letter === 'i' ? ' live-i' : ''}" style="--i:${i}">${letter === 'i' ? '<span class="live-i-stem">i</span>' : letter}</span>`).join('')}</span>`,
  // 思维卧底：眼睛代替第一只 o。
  impostor: '<span class="wm-impostor" aria-hidden="true"><span>Imp</span><span class="imp-eye"><span class="sus-eye"></span></span><span>stor</span></span>',
  // 极速闪电：z 的位置由折角闪电占据，字标疾驰时留下速度线。
  blitz: '<span class="wm-blitz" aria-hidden="true"><span class="bz-trails"></span><span class="bz-text">Blit<span class="bz-bolt">z</span></span></span>',
  // 语义搭桥：中间字母从左到右跃出，连接两端。
  bridge: `<span class="wm-bridge" aria-hidden="true"><span class="br-bank">B</span><span class="br-span">${[...'ridg'].map((letter, i) => `<span class="br-letter" data-letter="${letter}" style="--i:${i}"><span class="br-leap">${letter}</span></span>`).join('')}</span><span class="br-bank">e</span></span>`
};

// 模式标签里的艺术字：只有字形，语义交给旁边的中文名。
export function modeWordmarkMarkup(mode, className = '') {
  const art = wordmarkArt[mode];
  if (!art) return '';
  return `<span class="mode-wordmark${className ? ` ${className}` : ''}" aria-hidden="true">${art}</span>`;
}
