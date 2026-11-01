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
  banRepeat: (settings) => (settings.banRepeat ? '开启' : '关闭')
};

export function settingValueText(name, settings) {
  return SETTING_VALUE_TEXT[name](settings);
}

function settingValueMarkup(name, settings, control) {
  return `<span class="setting-value" data-setting-value="${name}" data-control="${control}">${escapeHtml(settingValueText(name, settings))}</span>`;
}

export function settingsMarkup(settings, editable) {
  // 只读时用纯文本取值替换控件，data-control 记录被替换控件的类型以对齐行高
  const control = (name, type, markup) => (editable ? markup : settingValueMarkup(name, settings, type));
  return `<section class="settings" data-editable="${editable}" aria-label="房间设置">
    <div class="setting-row">
      <span class="setting-label">模式</span>
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
  </section>`;
}

export function settingsSummaryText(settings) {
  const modeText = settings.mode === 'theme' ? '主题' : '自由';
  const repeatText = settings.banRepeat ? '禁重复' : '可重复';
  return `${modeText} · ${settings.maxRounds} 轮 · 写 ${settings.writeSeconds}s`;
}

export function shellMarkup(inRoom = false, user = null, renameOpen = false) {
  const name = user?.name || '';
  const uid = user?.uid || '';
  return `<header class="site-header" id="site-header">
    ${brandMarkup()}
    <div class="header-actions">
      <div class="header-user ${user ? 'is-visible' : ''}" id="header-user">
        ${avatarMarkup(name, 'header-avatar')}
        <span class="header-user-name" id="header-user-name">${escapeHtml(name)}</span>
        <button class="icon-button header-rename-trigger" type="button" data-action="rename" aria-label="修改名字" title="修改名字">${icon('pen-line')}</button>
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
          <button class="button secondary" type="button" data-action="cancel-rename">取消</button>
          <button class="button primary" type="submit">保存</button>
        </div>
      </form>
    </section>
  </div>
  <div id="stage" class="stage"></div>`;
}

export function homeMarkup(settings, settingsOpen = false) {
  return `<div class="page home-page" data-screen="home">
    <section class="intro">
      <div class="intro-main">
        <span class="intro-orbits" aria-hidden="true"><span class="intro-orb intro-orb-a"></span><span class="intro-orb intro-orb-b"></span></span>
        <h1>各自想一个，<br>直到想到一起。</h1>
      </div>
      <p>两个词之间，藏着我们想到的同一个东西。</p>
    </section>

    <div class="entry-deck">
      <form id="create-form" class="create-card">
        <button class="button primary create-submit" type="submit">
          <span class="create-submit-label"><span>创建房间</span>${icon('arrow-right', 'create-submit-arrow')}</span>
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
        <label class="sr-only" for="room-code">4 位房号</label>
        <input id="room-code" name="code" class="input code-input" placeholder="输入 4 位房号" maxlength="4" autocomplete="off" autocapitalize="characters" spellcheck="false" required>
        <button class="button secondary join-submit" type="submit">加入房间</button>
      </form>
    </div>
  </div>`;
}

export function playerItemMarkup(player, room, uid) {
  const isMe = player.uid === uid;
  const isHost = player.uid === room.hostUid;
  const isReady = !isHost && player.ready;
  const canTransfer = room.phase === 'lobby' && room.hostUid === uid && !isHost && player.connected;
  return `<li class="player ${isHost ? 'is-host' : ''} ${isReady ? 'is-ready' : ''} ${isMe ? 'is-me' : ''} ${canTransfer ? 'is-transferable' : ''}" data-uid="${escapeHtml(player.uid)}"${canTransfer
    ? ` data-action="transfer-host" tabindex="0" role="button" title="点击把房主转给 ${escapeHtml(player.name)}"`
    : ''} style="--player:var(--player-${player.seat})">
    ${avatarMarkup(player.name)}
    <div class="player-meta">
      <div class="player-name-row">
        <span class="player-name">${escapeHtml(player.name)}</span>
        ${isMe ? `<button class="icon-button rename-trigger" type="button" data-action="rename" aria-label="修改名字" title="修改名字">${icon('pen-line')}</button>` : ''}
        ${isMe ? '<span class="badge me-label">你</span>' : ''}
        ${!player.connected ? '<span class="badge offline-label">暂时离开</span>' : ''}
      </div>
    </div>
    ${isHost
      ? '<span class="ready-state host-state"><span>房主</span></span>'
      : `<span class="ready-state ${isReady ? 'ready' : ''}">${isReady ? `${icon('check')}<span>已准备</span>` : '<span>未准备</span>'}</span>`}
  </li>`;
}

export function lobbyMarkup(state) {
  const { room, uid } = state;
  const me = room.players.find((player) => player.uid === uid);
  const host = room.hostUid === uid;
  const canStart = host && room.players.length >= 2 && room.players
    .filter((player) => player.uid !== room.hostUid)
    .every((player) => player.ready && player.connected);
  return `<div class="page lobby-page" data-screen="lobby" data-room="${escapeHtml(room.code)}">
    <section class="room-banner">
      <div class="room-heading-copy">
        <h1>等待大家准备</h1>
        <p>邀请朋友，准备好后由房主开始。</p>
      </div>
      <div class="idle-clock" role="timer" aria-live="off" title="房间空闲 5 分钟后自动关闭">
        ${icon('clock')}
        <span id="idle-countdown"></span>
      </div>
      <button class="room-code-ticket" type="button" data-action="copy" aria-label="复制邀请链接" title="复制邀请链接">
        <span class="ticket-caption">房间号</span>
        <span class="ticket-code-row">
          <span class="ticket-code" id="lobby-room-code">${escapeHtml(room.code)}</span>
          ${icon('copy', 'ticket-copy-icon')}
        </span>
      </button>
    </section>

    <section class="surface-block players-block" aria-label="房间玩家">
      <div class="section-heading">
        <h2>${icon('users')}<span>玩家</span></h2>
        <span class="player-count" id="player-count">${room.players.length} / 4</span>
      </div>
      <ul class="player-list" id="player-list">
        ${room.players.map((player) => playerItemMarkup(player, room, uid)).join('')}
      </ul>
    </section>

    <section class="surface-block settings-block">
      <div class="section-heading">
        <h2>${icon('sliders-horizontal')}<span>房间设置</span></h2>
        ${!host ? '<span class="readonly-tag">房主可改</span>' : ''}
      </div>
      ${settingsMarkup(room, host)}
    </section>

    <div class="lobby-actions" id="lobby-actions">
      ${host
        ? `<button class="button primary start-button" type="button" data-action="start" ${canStart ? '' : 'disabled'}>${icon('play')}<span>开始</span></button>`
        : `<button class="button ${me?.ready ? 'secondary' : 'primary'} ready-button" type="button" data-action="ready">${me?.ready ? `${icon('x')}<span>取消准备</span>` : `${icon('check')}<span>准备</span>`}</button>`}
      <button class="button secondary lobby-leave-button" type="button" data-action="leave">${icon('log-out')}<span>退出</span></button>
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
          <button class="button secondary" type="button" data-action="cancel-transfer">取消</button>
          <button class="button primary" type="button" data-action="confirm-transfer">转让房主</button>
        </div>
      </section>
    </div>
  </div>`;
}

export function writingMarkup(state) {
  const { room } = state;
  return `<div class="page writing-page" data-screen="writing" data-room="${escapeHtml(room.code)}">
    <section class="writing-stage">
      <div class="round-pill">第 ${room.round} / ${room.maxRounds} 轮 · 房间 ${escapeHtml(room.code)}</div>
      <h1>各自写下此刻想到的词</h1>
      <p>${room.players.length} 位玩家同场作答</p>
      <div class="writing-clock" role="timer" aria-live="off">
        ${icon('clock')}
        <span id="countdown"></span>
      </div>
    </section>
  </div>`;
}
