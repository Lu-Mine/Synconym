import { historyHref, historySearchMarkup, highlightMatch } from './match-history.js';
import { chartMarkup } from './chart.js';

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

export function avatarMarkup(name, className = '') {
  const { tone } = avatarDetails(name);
  return `<img class="avatar ${className}" data-avatar-name="${escapeHtml(name)}" data-avatar-tone="${tone}" alt="" aria-hidden="true">`;
}

export function icon(name, className = '') {
  return `<svg class="icon ${className}" aria-hidden="true"><use href="/icons.svg#icon-${name}"></use></svg>`;
}

// 命中房号时整段高亮，「房号」前缀与数字之间的空格保持原样。
function roomCodeMarkup(code, className = '', hit = false) {
  const label = `房号 ${escapeHtml(code ?? '–')}`;
  return `<span class="room-code-display${className ? ` ${className}` : ''}">${icon('hash', 'room-code-icon')}<span>${hit ? `<mark class="history-hit">${label}</mark>` : label}</span></span>`;
}

export function brandMarkup() {
  return `<a class="brand" href="/" data-action="home" aria-label="返回近意词 Synconym 主页"><span class="brand-mark" aria-hidden="true"><span class="orb orb-a"></span><span class="orb orb-b"></span></span><span class="brand-cn"><span class="brand-wing-l">近</span><span class="brand-accent brand-yi">意</span><span class="brand-wing-r">词</span></span><span class="brand-en">Syn<span class="brand-accent brand-c">c</span>onym</span></a>`;
}

export function segmented(name, value, options, disabled = false) {
  const index = Math.max(0, options.findIndex((option) => String(option.value) === String(value)));
  return `<div class="segmented" role="group" data-segmented="${name}" style="--selected:${index};--count:${options.length}">${options.map((option) => {
    const isSelected = String(option.value) === String(value);
    return `<button class="segment ${isSelected ? 'selected' : ''}" type="button" data-setting="${name}" data-value="${option.value}" aria-pressed="${isSelected}" ${disabled ? 'disabled' : ''}>${option.label}</button>`;
  }).join('')}</div>`;
}

const SETTING_VALUE_TEXT = {
  mode: (settings) => (settings.mode === 'theme' ? '主题' : '自由'),
  maxRounds: (settings) => `${settings.maxRounds} 轮`,
  writeSeconds: (settings) => `${settings.writeSeconds} 秒`,
  prepareSeconds: (settings) => `${settings.prepareSeconds} 秒`,
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

export function settingsMarkup(settings, editable) {
  // 只读时用纯文本取值替换控件，data-control 记录被替换控件的类型以对齐行高
  const control = (name, type, markup) => (editable ? markup : settingValueMarkup(name, settings, type));
  return `<section class="settings" data-editable="${editable}" aria-label="房间设置">
    <div class="setting-row">
      <span class="mode-label"><span class="setting-label">模式</span><span class="theme-setting-hint" data-theme-setting-hint ${settings.mode === 'theme' ? '' : 'hidden'}>开始后随机抽取主题。</span></span>
      ${control('mode', 'segmented', segmented('mode', settings.mode, [{ value: 'free', label: '自由' }, { value: 'theme', label: '主题' }]))}
    </div>
    <div class="setting-row">
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
    </div>
    <div class="setting-row password-setting-row">
      ${editable ? `<label class="setting-label" for="room-password">设置密码</label>
      <input class="input code-input password-input" id="room-password" type="text" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="off" spellcheck="false" value="${escapeHtml(settings.password || '')}" aria-describedby="room-password-hint">
      <p class="password-setting-hint" id="room-password-hint">留空无密码，或 6 位数字密码</p>`
      : `<span class="setting-label">设置密码</span>${settingValueMarkup('passwordEnabled', settings, 'switch')}`}
    </div>
  </section>`;
}

export function themeMarkup(room) {
  return room.mode === 'theme' ? `<p class="current-theme"><span>${['result', 'rematch', 'interrupted'].includes(room.phase) ? '本局主题' : '当前主题'}</span><strong>${escapeHtml(room.themeName || '等待抽取')}</strong></p>` : '';
}

export function startCountdownMarkup(room) {
  return `<div class="start-countdown" data-screen="countdown" data-room="${escapeHtml(room.code || '')}" role="status">
    <p class="start-countdown-label">准备开始</p>
    <div id="countdown" class="start-countdown-number" role="timer" aria-live="off">5</div>
    ${room.mode === 'theme' && room.themeName ? `<p class="start-countdown-theme"><span>本局主题</span><strong>${escapeHtml(room.themeName)}</strong></p>` : ''}
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
      <a class="site-nav-link" href="https://github.com/Lu-Mine/Synconym" rel="noopener"><img class="footer-github-icon" src="/github-mark.svg" alt="" aria-hidden="true"><span>GitHub</span></a>
      <a class="site-nav-link" href="/?privacy" ${inRoom ? 'target="_blank" rel="noopener"' : 'data-action="open-privacy"'}>${icon('shield-check')}<span>隐私政策</span></a>
      <button class="site-nav-link" type="button" disabled title="内容尚未开放">${icon('circle-help')}<span>Q&amp;A</span></button>
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
      <div class="rename-dialog-actions">
        <button class="button secondary" type="button" data-action="cancel-confirm"><span>取消</span>${icon('x')}</button>
        <button class="button danger" type="button" data-action="accept-confirm"><span>退出房间</span>${icon('check')}</button>
      </div>
    </section>
  </div>
  <div class="rename-modal confirm-modal" id="join-modal" inert>
    <button class="rename-modal-backdrop" type="button" data-action="cancel-join" aria-label="取消加入房间"></button>
    <section class="rename-dialog" role="dialog" aria-modal="true" aria-labelledby="join-title" aria-describedby="join-room-number">
      <div class="rename-dialog-heading"><h2 id="join-title">确认加入房间？</h2><button class="icon-button" type="button" data-action="cancel-join" aria-label="取消">${icon('x')}</button></div>
      <p class="transfer-hint" id="join-room-number"></p>
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
  <footer class="site-footer">${brandMarkup()}<nav class="footer-links" aria-label="页脚链接"><a class="footer-privacy" href="https://github.com/Lu-Mine/Synconym" rel="noopener"><img class="footer-github-icon" src="/github-mark.svg" alt="" aria-hidden="true"><span>GitHub</span></a><a class="footer-privacy" href="/?privacy" ${inRoom ? 'target="_blank" rel="noopener"' : 'data-action="open-privacy"'}>${icon('shield-check')}<span>隐私说明</span></a><button class="footer-privacy" type="button" disabled title="内容尚未开放">${icon('circle-help')}<span>Q&amp;A</span></button></nav></footer>`;
}

export function privacyMarkup() {
  return `<article class="privacy-content privacy-in-app">
    <a class="button secondary privacy-back" href="/" data-action="home">${icon('arrow-right')}<span>返回主页</span></a>
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
          <p>首次访问时，服务端会分配随机 UID、昵称和独立身份凭证。浏览器将 UID 和凭证保存在本地存储中，用于识别和恢复身份；同时设置有效期为 30 天的 UID Cookie。主动退出遇到断线时，还会在会话存储中暂存退出意图。</p>
          <p>清除浏览器数据可能让你失去原身份和档案的访问方式。UID 不是密码；身份凭证可以用于恢复你的身份，请勿分享。</p></section>
        <section id="records"><h2>游戏中会记录什么</h2>
          <p>服务器保存 UID、身份凭证的哈希值、当前昵称、曾用名及相关时间。完成的对局会保存房号、模式、时间、结果、参与者昵称和 UID，以及每轮词语、标记和投票记录，用于游戏结算与档案展示。</p>
          <p>游玩时的房间状态和输入内容会在服务器内存中临时处理。写词阶段的内容不会提前展示给其他玩家；揭晓后，同房间玩家可以看到词语和相应的投票结果。崩局或中断的对局不会作为完成记录保存。</p></section>
      </div>
      <div class="privacy-aside">
        <section id="deletion"><h2>保存与删除</h2>
          <p>当前版本没有设置服务器数据的自动删除期限，也没有自助删除服务器记录的功能。档案中的「我是新人」只会生成新 UID 和昵称，不会删除旧身份或旧对局记录。</p>
          <p>你可以通过浏览器设置清除本地存储和 Cookie，但这不会删除服务器上的数据。如需了解或处理服务器上的数据，请联系你所使用的站点的运营者。</p></section>
        <section id="hosting"><h2>部署环境</h2>
          <p>游戏本身不要求注册手机号或密码。站点运营者使用的服务器、反向代理或托管平台可能另外处理网络连接信息或日志；这些做法取决于实际部署环境，请以该站点运营者提供的信息为准。</p></section>
      </div>
    </div>
    <a class="button secondary privacy-back privacy-back-bottom" href="/" data-action="home">${icon('arrow-right')}<span>返回主页</span></a>
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
    path: thoughtPathMarkup({ phase: 'result', players: DEMO_PLAYERS, history: [{ n: 1, words: words('海洋', '天空'), marks: {} }, { n: 2, words: words('蓝色', '蓝色'), marks: {} }] }).replace(/<p class="path-hint">[^<]*<\/p>/, ''),
    profile: `<ol class="profile-matches">${matches.map(profileMatchMarkup).join('')}</ol>`,
    vote: `<div class="demo-scene-break"><div class="writing-stage"><nav class="stage-progress">${stageProgressMarkup('breakVote')}</nav><h1>继续下一轮，还是结束本局？</h1></div>`
      + `<section class="surface-block"><div class="section-heading"><h2>玩家状态</h2></div><ul class="game-status-list">${gameStatusItemMarkup(a, 'done', '已投票', true)}${gameStatusItemMarkup(b, 'done', '已投票', false)}</ul></section>`
      + `<div class="game-actions">${demoButton('primary', 'data-action="break-no" disabled', `${icon('arrow-right')}<span>下一轮</span>`)}${demoButton('primary', 'data-action="break-yes" disabled', `<span>玩崩了</span>${icon('x')}`)}</div></div>`
  };
}

export function homeMarkup(settings, settingsOpen = false) {
  const demos = storyDemos();
  return `<div class="page home-page" data-screen="home">
    <div class="home-entry">
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
            ${settingsMarkup(settings, true)}
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
    </div>
    <a class="home-story-link" href="#home-story-title">了解玩法 ${icon('arrow-down')}</a>
    <section class="home-story" aria-labelledby="home-story-title">
      <div class="home-story-heading">
        <h2 id="home-story-title">${icon('sparkles', 'story-heading-icon')}<span>从不同的想法，走到同一个答案。</span></h2>
        <p>和 2–4 位朋友一起，用词语寻找彼此的默契。</p>
      </div>
      ${storyDemo('home-story-example', 'meet', demos.example)}
      <div class="home-story-how">
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

export function profileMatchMarkup(match, query = {}) {
  const met = match.outcome !== 'none';
  const outcome = met
    ? `第 ${match.convergedRound} 轮${match.outcome === 'voted' ? '投票' : ''}相遇`
    : `打满 ${match.totalRounds} 轮未相遇`;
  // 服务端只下发同局的其他人，头像与名字都按这份名单渲染
  const others = match.players || [];
  // hits 来自服务端：一条记录可能在多个维度上被搜到，命中的那几处分别高亮
  const hits = match.hits || {};
  const hitNames = new Map((hits.names || []).map((hit) => [hit.name, hit.whole]));
  const names = others.map((name) => (hitNames.has(name)
    ? highlightMatch(name, hitNames.get(name) ? '' : query.value)
    : escapeHtml(name))).join('、');
  const avatars = others.slice(0, 3).map((name) => avatarMarkup(name, 'profile-match-avatar')).join('');
  const rest = others.length > 3 ? `<span class="profile-match-avatar-rest">+${others.length - 3}</span>` : '';
  const startedAt = Number.isFinite(match.startedAt) ? new Date(match.startedAt).toISOString() : '';
  const date = relativeDate(match.startedAt);
  const theme = match.themeName ? (hits.theme ? highlightMatch(match.themeName, query.value) : escapeHtml(match.themeName)) : '';
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
  return `<div class="page profile-page" data-screen="profile">
    <section class="surface-block profile-identity">
      ${avatarMarkup(user.name, 'profile-avatar')}
      <div class="profile-identity-text">
        <h1 class="profile-name">${escapeHtml(user.name)}</h1>
        <p class="profile-uid">UID：${escapeHtml(user.uid)}<button class="icon-button profile-uid-copy" type="button" data-action="copy-uid" aria-label="复制 UID" title="复制 UID">${icon('copy')}</button></p>
        <p class="profile-meta">${icon('clock')}<span>加入于 ${escapeHtml(profileDate(user.createdAt))}${former.length ? ` · 曾用名 ${escapeHtml(former.join('、'))}` : ''}</span></p>
      </div>
    </section>
    <section class="surface-block profile-history">
      <div class="section-heading"><h2>${icon('route')}<span>对局记录</span></h2><span class="profile-total">${profile.total || 0} 局</span></div>
      ${historySearchMarkup(state.historyQuery)}
      ${matches.length
        ? `<ol class="profile-matches">${matches.map((match) => profileMatchMarkup(match, state.historyQuery)).join('')}</ol>`
        : `<p class="profile-empty">${profile.filter?.type ? '没有符合条件的对局，请调整搜索条件。' : '还没有完成的对局。开一局，回来就能看到。'}</p>`}
      ${pager}
    </section>
    <p class="profile-privacy">本设备保存 UID 和身份凭证；服务器保存凭证的哈希值、名字和完成过的对局记录。</p>
    <div class="profile-actions">
      <button class="button secondary" type="button" data-action="home">${icon('arrow-right')}<span>回主页</span></button>
      <button class="button danger" type="button" data-action="reset-identity">${icon('rotate-ccw')}<span>我是新人</span></button>
    </div>
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

export function lobbyPlayersMarkup(room, uid) {
  const players = room.players.map((player) => playerItemMarkup(player, room, uid)).join('');
  const emptySeats = '<li class="player player-empty"><span class="player-empty-avatar" aria-hidden="true"></span><span>2–4 人即可开玩</span></li>';
  return players + emptySeats.repeat(Math.max(0, 4 - room.players.length));
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
  const canStart = host && room.players.length >= 2 && room.players
    .filter((player) => player.uid !== room.hostUid)
    .every((player) => player.ready && player.connected);
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
        <span class="player-count" id="player-count">${room.players.length} / 4</span>
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

export function thoughtPathMarkup(room) {
  const players = Array.isArray(room?.players) ? room.players : [];
  const rounds = Array.isArray(room?.history) ? [...room.history] : [];
  if (room?.phase === 'voting' && room.words && !rounds.some((round) => round.n === room.round)) {
    rounds.push({ n: room.round, words: room.words, marks: room.marks || {} });
  }
  if (!rounds.length) return '<p class="path-empty">还没有揭晓的词，完成第一轮后就能看到思考路径。</p>';
  return `<p class="path-hint">按轮次查看每位玩家已揭晓的词</p><ol class="path-rounds">${rounds.map((round, index) => {
    const cards = players.map((player) => {
      const mark = round.marks?.[player.uid];
      const word = mark === 'empty' ? '[未提交]' : mark === 'invalid' ? '[非法答案]' : round.words?.[player.uid] || '[未参与]';
      const seat = Number.isInteger(player.seat) && player.seat >= 0 && player.seat < 4 ? player.seat : 0;
      return `<li class="path-answer" style="--player:var(--player-${seat});--card-color:var(--card-player-${seat})"><div class="path-player-heading">${avatarMarkup(player.name || '玩家', 'path-avatar')}<span class="path-name">${escapeHtml(player.name || '玩家')}</span></div><strong class="path-word">${escapeHtml(word)}</strong></li>`;
    }).join('');
    return `<li class="path-round-item">${index ? `<div class="path-connector" aria-hidden="true">${icon('arrow-down')}</div>` : ''}<section class="path-round-group"><h3>第 ${escapeHtml(round.n)} 轮</h3><ul class="path-answers" data-player-count="${Math.min(players.length, 4)}">${cards}</ul></section></li>`;
  }).join('')}</ol>`;
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
    </div>
    <div class="game-controls">
    ${phase === 'writing' ? `<div id="previous-words">${previousRound ? `<section class="surface-block"><div class="section-heading"><h2>上一轮的词</h2>${pathButton}</div><ul class="word-grid">${wordCards}</ul></section>` : ''}</div>` : ''}
    ${phase === 'writing' ? `<form id="word-form" class="surface-block game-form"><label for="word-input">你的词</label><input id="word-input" class="input" value="${escapeHtml(ui.draft || '')}" autocomplete="off" spellcheck="false" placeholder="输入 1–12 个汉字、字母或数字" ${submitted ? 'disabled' : ''}><p class="game-hint">可使用空格；超时将提交输入框中的内容</p><button class="button primary" type="submit" ${submitted ? 'disabled' : ''}><span>${submitted ? '已提交，等待其他玩家' : '提交'}</span>${icon('check')}</button></form>` : ''}
    ${phase === 'voting' || phase === 'prepare' || phase === 'breakVote' || phase === 'result' ? `<section class="surface-block"><div class="section-heading"><h2>本轮的词</h2>${pathButton}</div><ul class="word-grid">${wordCards}</ul></section>` : ''}
    ${phase === 'voting' ? `<div class="game-actions"><button class="button primary" type="button" data-action="vote-yes" ${voted ? 'disabled' : ''}><span>是</span>${icon('check')}</button><button class="button secondary" type="button" data-action="vote-no" ${voted ? 'disabled' : ''}><span>否</span>${icon('x')}</button></div><p class="game-hint game-center">${voted ? '已投票，等待揭晓' : '投票期间不会显示其他人的选择'}</p>` : ''}
    ${phase === 'prepare' ? `<button class="button primary game-wide" type="button" data-action="game-ready" ${ready ? 'disabled' : ''}><span>${ready ? '已准备，等待其他玩家' : '准备下一轮'}</span>${icon('check')}</button>` : ''}
    ${phase === 'breakVote' ? `<div class="game-actions"><button class="button primary" type="button" data-action="break-no" ${voted ? 'disabled' : ''}>${icon('arrow-right')}<span>下一轮</span></button><button class="button primary" type="button" data-action="break-yes" ${voted ? 'disabled' : ''}><span>玩崩了</span>${icon('x')}</button></div><p class="game-hint game-center">${voted ? '已选择，结果确定或倒计时结束后揭晓' : '选择提交后不可更改；结果确定后提前结束'}</p>` : ''}
    <button class="button secondary game-wide game-leave" type="button" data-action="leave">${icon('log-out')}<span>退出房间</span></button>
    </div>
  </div>`;
}

function wordCardMarkup(player, value, duplicate = false) {
  const seat = Number.isInteger(player.seat) && player.seat >= 0 && player.seat < 4 ? player.seat : 0;
  return `<li class="word-card previous-word-card" style="--player:var(--player-${seat});--card-color:var(--card-player-${seat})"><div class="previous-word-player">${avatarMarkup(player.name || '玩家', 'previous-word-avatar')}<span>${escapeHtml(player.name || '玩家')}</span></div><strong${duplicate ? ' class="word-duplicate"' : ''}>${escapeHtml(value)}</strong></li>`;
}

function gameStatusItemMarkup(player, statusKey, status, mine) {
  return `<li class="game-status status-${statusKey}"><span class="game-status-name">${avatarMarkup(player.name || '玩家', 'game-status-avatar')}<span>${escapeHtml(player.name || '玩家')}${mine ? '（你）' : ''}</span></span><span class="ready-state">${icon({ waiting: 'clock', active: 'pen-line', done: 'check', away: 'log-out' }[statusKey], 'game-status-icon')}<span>${status}</span></span></li>`;
}

const RESULT_LINES = {
  exact: ['这次想到一块了', '答案，终于一致了', '默契刚好对上', '不同的思路，同一个答案', '这一轮，心有灵犀', '这次，答案对上了'],
  voted: ['这份默契，大家认可', '词不同，想法很接近', '这一轮，大家都点头', '换个说法，也是同一种想法'],
  none: ['这局各有各的想法', '答案不同，过程也有意思', '这次还差一点默契', '先把这些灵感留在这里']
};

export function resultTitle(room) {
  if (room.outcome === 'break') return '本局已结束';
  const lines = room.outcome === 'exact' && room.history?.length === 1
    ? ['第一轮就想到一块了', '开局就有默契', '一个词，刚好想到一起']
    : RESULT_LINES[room.outcome] || RESULT_LINES.none;
  const seed = `${room.code}:${JSON.stringify(room.history || [])}`;
  let hash = 0;
  for (const ch of seed) hash = (Math.imul(hash, 31) + ch.codePointAt(0)) >>> 0;
  return lines[hash % lines.length];
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
  return `<section class="surface-block result-rematch" aria-label="下一步"><div class="section-heading"><h2>下一步</h2>${voting ? '<span class="rematch-clock" role="timer" aria-live="off">'+icon('clock')+'<span id="countdown">30 秒</span></span>' : ''}</div>
    <p class="rematch-description">全员重赛，按当前配置直接开下一局；想调整配置就回房间。</p>
    ${voting ? `<div class="result-player-status" aria-live="polite"><div class="section-heading"><h3>玩家状态</h3></div><ul class="game-status-list">${statuses}</ul></div>` : ''}
    <div class="rematch-actions">
      <button class="button primary" type="button" data-action="rematch-yes" ${!canChoose || roomChosen || mine === 'rematch' ? 'disabled' : ''}>${icon('play')}<span>${mine === 'rematch' ? '已选重赛' : '重赛'}</span></button>
      <button class="button secondary" type="button" data-action="rematch-room" ${!canChoose || mine === 'room' ? 'disabled' : ''}>${icon('users')}<span>${mine === 'room' ? '已选回房间' : '回房间'}</span></button>
      <button class="rematch-home" type="button" data-action="leave">${icon('arrow-right')}<span>回主页</span></button>
    </div>
    <p class="rematch-footnote">到期移除未选择或仍断线的玩家；剩余全选重赛且至少 2 人就直接开局，否则回房间。</p></section>`;
}

export function resultMarkup(state) {
  const { room, uid } = state;
  if (room.phase === 'interrupted') return `<div class="page result-page" data-screen="interrupted" data-room="${escapeHtml(room.code)}">
    <section class="result-heading"><div class="result-heading-copy"><div class="result-title-row"><h1>本局已中断</h1>${roomCodeMarkup(room.code, 'result-room-code')}</div><p>房间只剩一位玩家，本局不会记录。</p></div><div id="current-theme">${themeMarkup(room)}</div></section>
    <section class="surface-block result-rematch" aria-label="下一步"><div class="section-heading"><h2>下一步</h2></div><p class="rematch-description">回房间邀请朋友重新开始，或回主页退出房间。</p><div class="rematch-actions">
      <button class="button primary" type="button" data-action="rematch-room">${icon('users')}<span>回房间</span></button>
      <button class="button secondary" type="button" data-action="leave">${icon('arrow-right')}<span>回主页</span></button>
    </div></section></div>`;
  const players = room.resultPlayers || room.players || [];
  const history = room.history || [];
  const met = room.outcome === 'exact' || room.outcome === 'voted';
  const voting = room.phase === 'rematch';
  const voteRecords = history.map((round) => `<li class="result-vote-round"><h3>第 ${escapeHtml(round.n)} 轮 · ${round.outcome === 'exact' ? '精确相遇（无需投票）' : round.outcome === 'voted' ? '全票通过' : '未通过'}</h3>${round.votes ? `<ul class="result-vote-list">${players.map((p) => `<li><span>${escapeHtml(p.name)}</span><strong>${Object.hasOwn(round.votes, p.uid) ? round.votes[p.uid] ? '同意' : '否 / 超时' : '未参与'}</strong></li>`).join('')}</ul>` : ''}</li>`).join('');
  return `<div class="page result-page" data-screen="${voting ? 'rematch' : 'result'}" data-room="${escapeHtml(room.code)}">
    <section class="result-heading"><div class="result-heading-copy"><div class="result-title-row"><h1>${escapeHtml(resultTitle(room))}</h1>${roomCodeMarkup(room.code, 'result-room-code')}</div><p>${room.outcome === 'break' ? '崩局投票通过，本局记录不会保存。' : met ? `第 ${escapeHtml(history.at(-1)?.n ?? room.round)} 轮${room.outcome === 'voted' ? '投票达成一致' : '写出同一个词'}` : `走过 ${escapeHtml(history.length)} 轮，留下了这些不同的想法。`}</p></div><div id="current-theme">${themeMarkup(room)}</div></section>
    <div id="result-rematch" class="result-rematch-group">${rematchMarkup(state)}</div>
    <section class="surface-block"><div class="section-heading"><h2>收敛曲线</h2><button class="path-open" type="button" data-action="export-chart">导出 SVG</button></div><div class="result-chart-scroll">${chartMarkup(room)}</div><ul class="result-legend">${players.map((p) => `<li style="--player:var(--player-${p.seat})"><i></i>${escapeHtml(p.name)}</li>`).join('')}</ul><p class="game-hint">词向量估计仅供回顾，不参与胜负判定。空心点及虚线表示无法计算，不代表 0%；投票相遇以终点标识为准。多人局使用所有玩家两两相似度的平均值。</p></section>
    <section class="surface-block"><div class="section-heading"><h2>完整词路径</h2></div>${thoughtPathMarkup({ ...room, players })}</section>
    <details class="surface-block result-votes"><summary><span class="result-votes-label">投票记录<span>按需查看每轮选择</span></span>${icon('chevron-down', 'result-votes-icon')}</summary><ol class="result-vote-records">${voteRecords}</ol></details>
  </div>`;
}

export function matchDetailMarkup(detail, query = {}) {
  const back = `<a class="history-back" href="${escapeHtml(historyHref(query))}">返回对局记录</a>`;
  if (!detail || detail.error) return `<div class="page match-detail-page" data-screen="match-detail">${back}<h1>对局详情</h1><p role="status">${escapeHtml(detail?.error || '正在读取对局…')}</p></div>`;
  const match = detail.match;
  const room = { ...match, code: match.roomCode, history: match.history || match.rounds, resultPlayers: match.players };
  const outcome = match.outcome === 'none' ? `打满 ${match.totalRounds} 轮未相遇` : `第 ${match.convergedRound} 轮${match.outcome === 'voted' ? '投票' : ''}相遇`;
  const date = (value) => new Date(value).toLocaleString('zh-CN', { hour12: false });
  return `<div class="page match-detail-page" data-screen="match-detail">${back}
    <header class="match-detail-heading"><h1>${escapeHtml(outcome)}</h1><p>${roomCodeMarkup(match.roomCode)}<span>${escapeHtml(match.themeName ? `主题：${match.themeName}` : '自由模式')}</span></p><dl class="match-detail-facts"><div><dt>开始时间</dt><dd>${escapeHtml(date(match.startedAt))}</dd></div><div><dt>结束时间</dt><dd>${escapeHtml(date(match.endedAt))}</dd></div><div><dt>轮次</dt><dd>${match.totalRounds} / ${match.maxRounds}</dd></div></dl></header>
    <div class="match-detail-main">
    <section class="surface-block"><div class="section-heading"><h2>同局玩家</h2></div><ul class="match-detail-players">${match.players.map((player) => `<li>${avatarMarkup(player.name)}<div><strong>${escapeHtml(player.name)}</strong><span>UID：${escapeHtml(player.uid)}</span></div></li>`).join('')}</ul></section>
    <section class="surface-block"><div class="section-heading"><h2>完整词路径</h2></div>${thoughtPathMarkup(room)}</section>
    </div><div class="match-detail-aside">
    <section class="surface-block"><div class="section-heading"><h2>收敛曲线</h2></div><div class="result-chart-scroll">${chartMarkup(room)}</div><p class="game-hint">按当前词向量重新计算，仅供回顾，不参与胜负判定。空心点和虚线表示无法计算，并非 0%。</p></section>
    <details class="surface-block result-votes"><summary>逐轮投票记录 ${icon('chevron-down')}</summary><ol class="result-vote-records">${room.history.map((round) => `<li class="result-vote-round"><h3>第 ${round.n} 轮：${round.outcome === 'exact' ? '精确相遇，无需投票' : round.outcome === 'voted' ? '全票通过' : '未通过'}</h3>${round.votes ? `<ul class="result-vote-list">${match.players.map((p) => `<li><span>${escapeHtml(p.name)}</span><strong>${Object.hasOwn(round.votes, p.uid) ? round.votes[p.uid] ? '同意' : '否 / 超时' : '未参与'}</strong></li>`).join('')}</ul>` : ''}</li>`).join('')}</ol></details>
    </div>
  </div>`;
}
