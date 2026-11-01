export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

export function icon(name, className = '') {
  return `<svg class="icon ${className}" aria-hidden="true"><use href="/icons.svg#icon-${name}"></use></svg>`;
}

export function brandMarkup() {
  return `<a class="brand" href="/" data-action="home" aria-label="返回近意词 Synconym 主页"><span class="brand-mark" aria-hidden="true"><span class="orb orb-a"></span><span class="orb orb-b"></span></span><span class="brand-cn"><span class="brand-wing-l">近</span><span class="brand-accent brand-yi">意</span><span class="brand-wing-r">词</span></span><span class="brand-sep" aria-hidden="true"></span><span class="brand-en">Syn<span class="brand-accent brand-c">c</span>onym</span></a>`;
}

export function segmented(name, value, options, disabled = false) {
  return `<div class="segmented" role="group" style="--selected:${options.findIndex((option) => String(option.value) === String(value))};--count:${options.length}">${options.map((option) =>
    `<button class="segment ${String(option.value) === String(value) ? 'selected' : ''}" type="button" data-setting="${name}" data-value="${option.value}" aria-pressed="${String(option.value) === String(value)}" ${disabled ? 'disabled' : ''}>${option.label}</button>`).join('')}</div>`;
}

export function settingsMarkup(settings, editable) {
  return `<section class="settings" aria-label="房间设置">
    <div class="setting-row"><span>模式</span>${segmented('mode', settings.mode, [{ value: 'free', label: '自由' }, { value: 'theme', label: '主题' }], !editable)}</div>
    <div class="setting-row"><label for="rounds">轮次上限</label><div class="stepper">
      <button class="icon-button" data-step="-1" aria-label="减少轮次" ${!editable || settings.maxRounds <= 4 ? 'disabled' : ''}>${icon('minus')}</button>
      <output id="rounds" class="stepper-value">${settings.maxRounds}</output>
      <button class="icon-button" data-step="1" aria-label="增加轮次" ${!editable || settings.maxRounds >= 20 ? 'disabled' : ''}>${icon('plus')}</button>
    </div></div>
    <div class="setting-row"><span>写词时限</span>${segmented('writeSeconds', settings.writeSeconds, [15, 30, 45, 60].map((value) => ({ value, label: `${value} 秒` })), !editable)}</div>
    <div class="setting-row"><span>准备时限</span>${segmented('prepareSeconds', settings.prepareSeconds, [15, 30, 45, 60].map((value) => ({ value, label: `${value} 秒` })), !editable)}</div>
    <div class="setting-row"><label for="banRepeat">禁止重复词</label><button id="banRepeat" class="switch" role="switch" aria-checked="${settings.banRepeat}" data-setting="banRepeat" aria-label="禁止重复词" ${!editable ? 'disabled' : ''}><span></span></button></div>
  </section>`;
}

export function homeMarkup(settings) {
  return `<div class="page home-page"><header class="home-header">${brandMarkup()}</header>
    <section class="intro"><h1>各自想一个，<br>直到想到一起。</h1><p>两个词之间，藏着我们想到的同一个东西。</p></section>
    <form id="create-form"><button class="button primary" type="submit">${icon('plus')}创建房间</button></form>
    <div class="join-heading">或者加入朋友的房间</div>
    <form id="join-form" class="join-form"><label class="sr-only" for="room-code">4 位房号</label><input id="room-code" name="code" class="input code-input" placeholder="输入 4 位房号" maxlength="4" autocomplete="off" autocapitalize="characters" spellcheck="false" required><button class="button secondary" type="submit">加入房间</button></form>
    <details class="create-settings"><summary>${icon('settings')}房间设置${icon('chevron-down', 'chevron')}</summary><div class="details-content">${settingsMarkup(settings, true)}</div></details>
  </div>`;
}

export function lobbyMarkup(state) {
  const { room, uid } = state;
  const me = room.players.find((player) => player.uid === uid);
  const host = room.hostUid === uid;
  const canStart = host && room.players.length >= 2 && room.players.every((player) => player.ready && player.connected);
  return `<div class="page lobby-page"><header class="lobby-header">${brandMarkup()}<button class="icon-button leave-button" data-action="leave" aria-label="退出房间" title="退出房间">${icon('log-out')}</button></header>
    <section class="room-heading"><div><h1>等待大家准备</h1><p>邀请朋友，准备好后由房主开始。</p></div><button class="room-code" data-action="copy" aria-label="复制邀请链接" title="复制邀请链接"><span>${escapeHtml(room.code)}</span>${icon('copy')}</button></section>
    <section class="players" aria-label="房间玩家"><div class="section-heading"><h2>${icon('users')}玩家</h2><span>${room.players.length} / 4</span></div><ul class="player-list">${room.players.map((player) => `<li class="player" style="--player:var(--player-${player.seat})">
      <span class="avatar">${escapeHtml([...player.name][0] || '')}</span><div class="player-name">${escapeHtml(player.name)}${player.uid === room.hostUid ? '<span class="host-label">房主</span>' : ''}${!player.connected ? '<span class="offline-label">暂时离开</span>' : ''}</div>
      ${player.uid === uid ? `<button class="icon-button" data-action="rename" aria-label="修改名字" title="修改名字">${icon('user')}</button>` : ''}<span class="ready-state ${player.ready ? 'ready' : ''}">${player.ready ? icon('check') + '已准备' : '未准备'}</span></li>`).join('')}</ul></section>
    <form id="rename-form" class="rename-form" hidden><label class="sr-only" for="player-name">名字</label><input id="player-name" class="input" maxlength="12" required value="${escapeHtml(me?.name || '')}"><button class="button secondary" type="submit">保存名字</button></form>
    ${settingsMarkup(room, host)}
    <div class="lobby-actions"><button class="button ${me?.ready ? 'secondary' : 'primary'}" data-action="ready">${me?.ready ? icon('x') + '取消准备' : icon('check') + '准备'}</button>
    ${host ? `<button class="button primary" data-action="start" ${canStart ? '' : 'disabled'}>${icon('play')}开始</button>` : ''}</div>
  </div>`;
}

export function writingMarkup(state) {
  return `<div class="page"><header class="lobby-header">${brandMarkup()}</header><section class="intro"><h1>第 ${state.room.round} 轮</h1><p>房间 ${escapeHtml(state.room.code)} · ${state.room.players.length} 位玩家</p></section><div class="writing-clock">${icon('clock')}<span id="countdown"></span></div></div>`;
}
