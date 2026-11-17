const STAGES = {
  home: '01', insane: '02', profile: '03', 'match-detail': '04', qa: '05', privacy: '06',
  lobby: '07', countdown: '08', result: '09', rematch: '10', interrupted: '51',
  writing: '101', voting: '102', breakVote: '103', prepare: '104',
  lvIntro: '121', lvPlay: '122', lvScore: '123'
};

const frames = [0, 1, 2].map((i) => document.getElementById(`frame-${i}`));
const paneStates = [
  { uid: '', name: '', room: null, scene: '' },
  { uid: '', name: '', room: null, scene: '' },
  { uid: '', name: '', room: null, scene: '' }
];

const btnStart = document.getElementById('btn-start');
const btnPause = document.getElementById('btn-pause');
const btnStep = document.getElementById('btn-step');
const btnInterrupt = document.getElementById('btn-interrupt');
const btnReset = document.getElementById('btn-reset');
const speedSelect = document.getElementById('speed');
const layoutSelect = document.getElementById('layout-mode');
const trioGrid = document.getElementById('trio-grid');

const stepBadge = document.getElementById('step-badge');
const stepTitle = document.getElementById('step-title');
const stepDetail = document.getElementById('step-detail');
const stepPills = [...document.querySelectorAll('.trio-step-pill')];

let runId = 0;
let running = false;
let paused = false;
let stepResolve = null;

function doc(i) {
  return frames[i]?.contentDocument || null;
}

function win(i) {
  return frames[i]?.contentWindow || null;
}

function speed() {
  return Number(speedSelect.value) || 1;
}

function setBanner(stepNo, title, detail) {
  stepBadge.textContent = stepNo ? `步骤 ${stepNo}/10` : '就绪';
  stepTitle.textContent = title;
  stepDetail.textContent = detail;
  for (const pill of stepPills) {
    const n = Number(pill.dataset.step);
    pill.classList.toggle('is-active', stepNo > 0 && n === stepNo);
    pill.classList.toggle('is-done', stepNo > 0 && n < stepNo);
  }
}

function updatePaneHead(i) {
  const st = paneStates[i];
  const d = doc(i);
  const headerName = d?.querySelector('#header-user-name')?.textContent?.trim();
  if (headerName) st.name = headerName;
  const nameEl = document.getElementById(`name-${i}`);
  const roleEl = document.getElementById(`role-${i}`);
  const stageEl = document.getElementById(`stage-${i}`);

  const uidText = st.uid ? ` (${st.uid})` : '';
  nameEl.textContent = st.name ? `${st.name}${uidText}` : '连接中…';

  const scene = st.scene || d?.querySelector('.page')?.dataset?.screen || d?.body?.dataset?.scene || 'home';
  stageEl.textContent = STAGES[scene] || '--';

  let roleLabel = scene === 'home' ? '首页' : scene === 'qa' ? 'Q&A' : scene === 'insane' ? '狂意大厅' : scene;
  let roleClass = 'trio-role-tag';
  const room = st.room;
  if (room) {
    if (room.phase === 'lobby') {
      roleLabel = room.hostUid === st.uid ? '房主 · 等待中' : (room.players?.find((p) => p.uid === st.uid)?.ready ? '已准备' : '未准备');
    } else if (room.phase === 'countdown') {
      roleLabel = '开局倒计时';
    } else if (['lvIntro', 'lvPlay', 'lvScore'].includes(room.phase)) {
      const lv = room.livonym || {};
      if (lv.describerUid === st.uid) {
        roleLabel = room.phase === 'lvScore' ? '本轮出题人' : '出题人';
        roleClass = 'trio-role-tag is-describer';
      } else {
        const guessed = (lv.guessed || []).find((g) => g.uid === st.uid);
        if (guessed) {
          const spectating = d?.querySelector('#header-spectate-bar.is-active') && d?.querySelector('#spectate-ambient.is-active');
          roleLabel = spectating ? '已猜中 · 旁观中' : `第 ${guessed.order} 名猜中`;
          roleClass = 'trio-role-tag is-guessed';
        } else {
          roleLabel = '竞猜者';
          roleClass = 'trio-role-tag is-guesser';
        }
      }
    } else if (room.phase === 'result' || room.phase === 'rematch') {
      roleLabel = '终局结算';
    } else if (room.phase === 'interrupted') {
      roleLabel = '对局中断';
    }
  } else if (scene === 'profile') {
    roleLabel = d?.querySelector('.match-detail-page') ? '历史详情' : '个人档案';
  }
  roleEl.textContent = roleLabel;
  roleEl.className = roleClass;
}

window.addEventListener('message', (event) => {
  if (event.origin !== location.origin) return;
  const idx = frames.findIndex((f) => f?.contentWindow === event.source);
  if (idx < 0) return;
  if (event.data?.type === 'mock-state') {
    paneStates[idx].room = event.data.room ?? null;
    if (event.data.uid) paneStates[idx].uid = event.data.uid;
    updatePaneHead(idx);
  } else if (event.data?.type === 'mock-scene') {
    paneStates[idx].scene = event.data.scene || '';
    updatePaneHead(idx);
  }
});

setInterval(() => {
  for (let i = 0; i < 3; i++) updatePaneHead(i);
}, 300);

function sendMockAction(i, action, extra = {}) {
  win(i)?.postMessage({ type: 'mock-action', action, ...extra }, location.origin);
}

async function checkPause(myRunId) {
  if (myRunId !== runId) throw new Error('ABORTED');
  while (paused) {
    if (myRunId !== runId) throw new Error('ABORTED');
    await new Promise((resolve) => { stepResolve = resolve; });
    stepResolve = null;
    if (myRunId !== runId) throw new Error('ABORTED');
    if (paused) break;
  }
}

async function waitMs(ms, myRunId, options = {}) {
  const realMinMs = options.realMinMs || 0;
  const scaled = Math.max(realMinMs, Math.max(40, Math.round(ms / speed())));
  const end = Date.now() + scaled;
  while (Date.now() < end) {
    await checkPause(myRunId);
    const slice = Math.min(80, Math.max(10, end - Date.now()));
    await new Promise((r) => setTimeout(r, slice));
  }
  await checkPause(myRunId);
}

async function waitGuessReady(i, myRunId) {
  await waitFor(() => {
    const form = q(i, '#guess-form');
    return form && !form.classList.contains('is-cooling');
  }, myRunId, 4000, `玩家 ${i + 1} 猜测冷却结束`);
}

async function waitFor(fn, myRunId, timeoutMs = 15000, label = '条件') {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await checkPause(myRunId);
    const value = fn();
    if (value) return value;
    await new Promise((r) => setTimeout(r, 70));
  }
  throw new Error(`等待超时：${label}`);
}

function q(i, selector) {
  return doc(i)?.querySelector(selector) || null;
}

function clickEl(i, selector) {
  const el = q(i, selector);
  if (!el) throw new Error(`玩家 ${i + 1} 未找到元素：${selector}`);
  el.click();
  return el;
}

function setInput(i, selector, value) {
  const el = q(i, selector);
  if (!el) throw new Error(`玩家 ${i + 1} 未找到输入框：${selector}`);
  el.focus();
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return el;
}

async function typeText(i, selector, text, myRunId, charMs = 55) {
  const el = q(i, selector);
  if (!el) throw new Error(`玩家 ${i + 1} 未找到输入框：${selector}`);
  el.focus();
  let current = '';
  for (const ch of [...text]) {
    await checkPause(myRunId);
    current += ch;
    el.value = current;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    await waitMs(charMs, myRunId);
  }
}

function submitForm(i, selector) {
  const form = q(i, selector);
  if (!form) throw new Error(`玩家 ${i + 1} 未找到表单：${selector}`);
  if (typeof form.requestSubmit === 'function') form.requestSubmit();
  else form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
}

function wrongWordFor(secret, variant = 0) {
  const len = [...String(secret || '')].length || 2;
  const pools = {
    1: ['云', '水', '风', '光'],
    2: ['苹果', '森林', '吉他', '彩虹'],
    3: ['电风扇', '笔记本', '仙人掌', '热气球'],
    4: ['海市蜃楼', '春暖花开', '一心一意', '风和日丽']
  };
  const candidates = pools[len] || [
    '测试词一二三四五六七八'.slice(0, len),
    '联想答案甲乙丙丁戊己'.slice(0, len)
  ];
  return candidates.find((w) => w !== secret && candidates.indexOf(w) >= variant)
    || candidates.find((w) => w !== secret)
    || '备用错词'.slice(0, len);
}

function clearMockSlotStorage() {
  for (const slot of ['p1', 'p2', 'p3']) {
    for (const prefix of ['sy_mock_identity', 'sy_mock_uid', 'sy_mock_pending_leave']) {
      sessionStorage.removeItem(`${prefix}_${slot}`);
    }
  }
}

async function bootFrames(myRunId) {
  clearMockSlotStorage();
  for (let i = 0; i < 3; i++) {
    paneStates[i] = { uid: '', name: '', room: null, scene: '' };
    frames[i].src = `/__mock/play?slot=p${i + 1}&_=${Date.now()}_${i}`;
  }
  await waitFor(() => [0, 1, 2].every((i) => (
    paneStates[i].uid
    && q(i, '#create-form')
    && q(i, '#header-user-name')?.textContent?.trim()
  )), myRunId, 15000, '三屏初始化连接');
}

async function renamePlayer(i, newName, myRunId) {
  clickEl(i, '.rename-trigger, .header-rename-trigger');
  await waitFor(() => q(i, '#rename-modal.is-open #player-name'), myRunId, 4000, '改名弹窗');
  setInput(i, '#player-name', newName);
  submitForm(i, '#rename-form');
  await waitFor(() => paneStates[i].room?.players?.some((p) => p.uid === paneStates[i].uid && p.name === newName), myRunId, 5000, '改名同步');
}

async function runFullFlow(myRunId) {
  setBanner(0, '初始化 3 个独立玩家视角…', '正在清空旧会话并建立 3 条独立 WebSocket 连接。');
  await bootFrames(myRunId);
  await waitMs(700, myRunId);

  // 步骤 1：Q&A 条目与狂意大厅预配置
  setBanner(1, 'R1：查看 Q&A 新增条目 → 进入狂意大厅并预配置房间', '玩家 1 打开 Q&A 查看即时竞猜规则，随后进入 ?insane 预配 45 秒 / 1 轮 / 密码 123456 建房。');
  clickEl(0, 'a[data-action="open-qa"]');
  await waitFor(() => q(0, '.qa-content'), myRunId, 5000, 'Q&A 页面');
  const qaItems = [...doc(0).querySelectorAll('.qa-item')];
  const livonymQa = qaItems.find((d) => /即时竞猜|Livonym/i.test(d.textContent));
  if (livonymQa) {
    livonymQa.open = true;
    livonymQa.scrollIntoView({ block: 'center' });
  }
  await waitMs(1500, myRunId);
  clickEl(0, '.privacy-back');
  await waitFor(() => q(0, '[data-action="toggle-settings"]'), myRunId, 5000, '返回首页');
  clickEl(0, '[data-action="toggle-settings"]');
  await waitMs(350, myRunId);
  clickEl(0, '[data-action="open-insane"]');
  await waitFor(() => q(0, '.insane-card--livonym'), myRunId, 5000, '狂意大厅');

  const lvCard = q(0, '.insane-card--livonym');
  const details = lvCard.querySelector('.insane-details');
  if (details && !details.open) lvCard.querySelector('summary')?.click();
  await waitMs(600, myRunId);
  lvCard.querySelector('[data-setting="describeSeconds"][data-value="60"]')?.click();
  await waitMs(250, myRunId);
  lvCard.querySelector('[data-setting="describeSeconds"][data-value="45"]')?.click();
  lvCard.querySelector('[data-setting="roundsPerPlayer"][data-value="1"]')?.click();
  const pwdInput = lvCard.querySelector('#insane-password');
  if (pwdInput) {
    pwdInput.value = '123456';
    pwdInput.dispatchEvent(new Event('input', { bubbles: true }));
  }
  await waitMs(900, myRunId);
  lvCard.querySelector('[data-action="create-insane-room"]')?.click();

  await waitFor(() => paneStates[0].room?.phase === 'lobby', myRunId, 8000, '玩家1建房进大厅');
  const roomCode = paneStates[0].room.code;

  // 步骤 2：大厅人数提示、密码加入、改名、头像顺序换位与全员准备
  setBanner(2, `R2：大厅 ${roomCode}（3–8 人提示 / 密码验证 / 头像左上角出题顺序换位）`, '玩家 2、3 通过房号与密码 123456 加入，三人改名后演示转让房主换位（序号随位置保持从上到下 1→2→3）。');
  await waitMs(700, myRunId);

  for (const idx of [1, 2]) {
    setInput(idx, '#room-code', roomCode);
    await waitFor(() => q(idx, '#join-modal.is-open'), myRunId, 6000, `玩家${idx + 1}加入确认弹窗`);
    await waitMs(400, myRunId);
    setInput(idx, '#join-password', '123456');
    clickEl(idx, '[data-action="confirm-join"]');
    await waitFor(() => paneStates[idx].room?.phase === 'lobby' && q(idx, '[data-action="ready"]'), myRunId, 6000, `玩家${idx + 1}进入大厅`);
  }

  await renamePlayer(0, '玩家甲', myRunId);
  await renamePlayer(1, '玩家乙', myRunId);
  await renamePlayer(2, '玩家丙', myRunId);
  await waitMs(700, myRunId, { realMinMs: 600 });

  // 演示换位的同时也换顺序：甲转让房主给丙 → 丙移到第 1 位变成 1 号，之后丙再转回给甲恢复 1 号
  const p1Uid = paneStates[0].uid;
  const p3LobbyUid = paneStates[2].uid;
  clickEl(0, `#player-list .player[data-action="transfer-host"][data-uid="${p3LobbyUid}"]`);
  await waitFor(() => q(0, '#transfer-modal.is-open [data-action="confirm-transfer"]'), myRunId, 4000, '转让房主确认弹窗');
  clickEl(0, '#transfer-modal [data-action="confirm-transfer"]');
  await waitFor(() => paneStates[0].room?.hostUid === p3LobbyUid && paneStates[2].room?.players?.[0]?.uid === p3LobbyUid, myRunId, 5000, '丙移到第一位并变成1号');
  await waitMs(900, myRunId, { realMinMs: 700 });

  await waitFor(() => q(2, `#player-list .player[data-action="transfer-host"][data-uid="${p1Uid}"]`), myRunId, 4000, '丙界面显示转回按钮');
  clickEl(2, `#player-list .player[data-action="transfer-host"][data-uid="${p1Uid}"]`);
  await waitFor(() => q(2, '#transfer-modal.is-open [data-action="confirm-transfer"]'), myRunId, 4000, '丙转让回房主弹窗');
  clickEl(2, '#transfer-modal [data-action="confirm-transfer"]');
  await waitFor(() => paneStates[0].room?.hostUid === p1Uid && paneStates[0].room?.players?.[0]?.uid === p1Uid, myRunId, 5000, '甲回到第一位并恢复1号');
  await waitMs(650, myRunId, { realMinMs: 600 });

  clickEl(1, '[data-action="ready"]');
  await waitMs(350, myRunId);
  clickEl(2, '[data-action="ready"]');
  await waitFor(() => q(0, '[data-action="start"]:not(:disabled)'), myRunId, 6000, '房主开始按钮可用');
  await waitMs(900, myRunId);
  clickEl(0, '[data-action="start"]');

  // 步骤 3：5s 开局倒计时
  setBanner(3, 'R2：5 秒开局倒计时（展示总棒数与出题顺序）', '三屏同步展示开局倒计时、「共 3 棒」及玩家甲→乙→丙轮替顺序。');
  await waitFor(() => [0, 1, 2].every((i) => paneStates[i].room?.phase === 'countdown'), myRunId, 5000, '开局倒计时');
  await waitMs(3800, myRunId);

  // 步骤 4：第 1 棒 lvIntro（5秒）
  setBanner(4, 'R2：第 1 棒出题准备 lvIntro（5 秒 + 居中字数提示）', '玩家甲看到秘密词与标题正中「N 个字」；乙、丙看到「••••」与字数提示。');
  await waitFor(() => [0, 1, 2].every((i) => paneStates[i].room?.phase === 'lvIntro'), myRunId, 5000, '第1棒 lvIntro');
  await waitMs(4200, myRunId);

  // 步骤 5：第 1 棒 lvPlay（全核心功能交互演示）
  await waitFor(() => [0, 1, 2].every((i) => paneStates[i].room?.phase === 'lvPlay')
    && q(0, '#livonym-secret') && q(0, '#describe-input') && q(1, '#guess-input') && q(2, '#guess-input'),
    myRunId, 6000, '第1棒 lvPlay');
  const secret1 = q(0, '#livonym-secret')?.textContent?.trim();

  setBanner(5, `R3：第 1 棒「${secret1}」— 角色提示/50字超限/去标点拦截/弹幕/错词标签/旁观/N-1锁框`, '1）甲演示超50字红框再删回恢复；2）插入标点防剧透高亮；3）乙发非词汇弹幕(1s冷却)；4）乙丙猜错留标签(1.5s冷却)；5）乙猜中+N-1锁框+旁观丙；6）丙猜中悬崖归零！');

  // 暂停服务端时钟以便慢速完整展示所有交互细节，演示后再恢复
  sendMockAction(0, 'pause');
  await waitMs(400, myRunId);

  // 5a. 超 50 字再删回 <=50 字恢复
  const longText = '一二三四五六七八九十'.repeat(5) + '超字测试';
  setInput(0, '#describe-input', longText);
  await waitMs(800, myRunId);
  setInput(0, '#describe-input', '一二三四五六七八九十'.repeat(5));
  await waitMs(600, myRunId);

  // 5b. 标点绕过本地防泄漏拦截 + #describe-hint 高亮
  const chars1 = [...secret1];
  const leaked = chars1.length >= 2 ? `${chars1[0]}/${chars1.slice(1).join('')}` : secret1;
  setInput(0, '#describe-input', `提示一下：就是${leaked}呀`);
  await waitMs(1200, myRunId);

  // 5c. 正常多行描述（本地左上对齐 vs 观众全居中流式）
  setInput(0, '#describe-input', '');
  await typeText(0, '#describe-input', '生活中常见的东西\n提示：和它的用途有关\n仔细想想日常场景', myRunId, 45);
  await waitMs(600, myRunId);

  // 5d. 乙发送非词汇弹幕（含标点与长度不符）→ 滚动弹幕 + 1s 冷却
  setInput(1, '#guess-input', '这也太抽象了吧！！');
  submitForm(1, '#guess-form');
  await waitMs(1250, myRunId, { realMinMs: 1150 });
  await waitGuessReady(1, myRunId);

  // 5e. 乙、丙各猜错一次 → 1.5s 冷却 + 错词标签
  const wrongB1 = wrongWordFor(secret1, 0);
  const wrongC1 = wrongWordFor(secret1, 1);
  setInput(1, '#guess-input', wrongB1);
  submitForm(1, '#guess-form');
  await waitMs(250, myRunId);
  setInput(2, '#guess-input', wrongC1);
  submitForm(2, '#guess-form');
  await waitMs(1750, myRunId, { realMinMs: 1650 });
  await waitGuessReady(1, myRunId);
  await waitGuessReady(2, myRunId);

  // 恢复服务端倒计时，继续真实计时猜中
  sendMockAction(0, 'resume');
  await waitMs(300, myRunId);

  // 5f. 乙第 1 个猜中 → 乙变绿 +3 分，且 N-1 (1/2) 立即锁定甲的输入框！
  setInput(1, '#guess-input', secret1);
  submitForm(1, '#guess-form');
  await waitFor(() => (paneStates[1].room?.livonym?.guessed?.length || 0) >= 1, myRunId, 5000, '玩家乙猜中');
  await waitMs(900, myRunId);

  // 5g. 乙点击左侧列表中的玩家丙进入旁观视角，丙同步再猜错一次让乙实时看到丙视角变化
  const p3Uid = paneStates[2].uid;
  clickEl(1, `#livonym-guessed .livonym-guessed-item[data-uid="${p3Uid}"]`);
  await waitFor(() => q(1, '#header-spectate-bar.is-active') && q(1, '#spectate-ambient.is-active'), myRunId, 3000, '玩家乙进入旁观视角');
  await waitMs(600, myRunId);
  const wrongC2 = wrongWordFor(secret1, 2);
  if (wrongC2 !== wrongC1) {
    await waitGuessReady(2, myRunId);
    setInput(2, '#guess-input', wrongC2);
    submitForm(2, '#guess-form');
    await waitMs(1750, myRunId, { realMinMs: 1650 });
  } else {
    await waitMs(1200, myRunId, { realMinMs: 1100 });
  }
  await waitGuessReady(2, myRunId);

  // 5h. 丙也猜中 → 全员猜中触发出题人甲得 0 分（悬崖机制），自动进入 lvScore
  setInput(2, '#guess-input', secret1);
  submitForm(2, '#guess-form');

  // 步骤 6：第 1 棒 lvScore（6秒）
  await waitFor(() => [0, 1, 2].every((i) => paneStates[i].room?.phase === 'lvScore')
    && q(1, `.livonym-score-row[data-uid="${p3Uid}"]`),
    myRunId, 6000, '第1棒 lvScore');
  setBanner(6, 'R4：第 1 棒 6 秒结算（全员猜中出题人 +0 分 · ID 旁展示用时）', '展示秘密词、全都猜中了原因、玩家用时（如 4.2s），点击玩家名可展开错词浮窗。');
  await waitMs(1000, myRunId);
  q(1, `.livonym-score-row[data-uid="${p3Uid}"] [data-action="toggle-wrong-popover"]`)?.click();
  await waitMs(4800, myRunId);

  // 步骤 7：第 2 棒（玩家乙出题，仅玩家甲猜中 → 乙得 +1 分！）
  setBanner(7, '第 2 棒：玩家乙出题（验证旁观视角自动复位 & 部分猜中出题人 +1 分）', '5 秒准备后进入第 2 棒；仅甲猜中、丙未猜中，演示非全中时出题人正常得分。');
  await waitFor(() => [0, 1, 2].every((i) => paneStates[i].room?.phase === 'lvIntro'), myRunId, 5000, '第2棒 lvIntro');
  await waitMs(4500, myRunId);
  await waitFor(() => [0, 1, 2].every((i) => paneStates[i].room?.phase === 'lvPlay')
    && q(1, '#livonym-secret') && q(1, '#describe-input') && q(0, '#guess-input') && q(2, '#guess-input'),
    myRunId, 6000, '第2棒 lvPlay');

  const secret2 = q(1, '#livonym-secret')?.textContent?.trim();
  await typeText(1, '#describe-input', '换个风格描述第2题\n只有一个人想得到', myRunId, 45);
  await waitMs(400, myRunId);
  setInput(2, '#guess-input', '猜猜看这是什么！'); // 丙发一条弹幕
  submitForm(2, '#guess-form');
  await waitMs(500, myRunId);
  setInput(0, '#guess-input', secret2); // 甲第 1 个猜中
  submitForm(0, '#guess-form');
  await waitFor(() => (paneStates[0].room?.livonym?.guessed?.length || 0) >= 1, myRunId, 5000, '第2棒甲猜中');
  await waitMs(1800, myRunId);
  // 用 mockAction 直接推进到第 2 棒结算（避免空等 35 秒）
  sendMockAction(0, 'advance');
  await waitFor(() => [0, 1, 2].every((i) => paneStates[i].room?.phase === 'lvScore'), myRunId, 5000, '第2棒 lvScore');
  await waitMs(5200, myRunId);

  // 步骤 8：第 3 棒（玩家丙出题）
  setBanner(8, '第 3 棒：玩家丙出题（最后一棒冲刺结算）', '丙描述最后一题，甲、乙抢猜并进入最后一轮 6 秒结算。');
  await waitFor(() => [0, 1, 2].every((i) => paneStates[i].room?.phase === 'lvIntro'), myRunId, 5000, '第3棒 lvIntro');
  await waitMs(4500, myRunId);
  await waitFor(() => [0, 1, 2].every((i) => paneStates[i].room?.phase === 'lvPlay')
    && q(2, '#livonym-secret') && q(2, '#describe-input') && q(0, '#guess-input') && q(1, '#guess-input'),
    myRunId, 6000, '第3棒 lvPlay');

  const secret3 = q(2, '#livonym-secret')?.textContent?.trim();
  await typeText(2, '#describe-input', '最后一棒！\n非常经典的东西', myRunId, 45);
  await waitMs(400, myRunId);
  setInput(0, '#guess-input', wrongWordFor(secret3, 0));
  submitForm(0, '#guess-form');
  await waitMs(400, myRunId);
  setInput(1, '#guess-input', secret3);
  submitForm(1, '#guess-form');
  await waitMs(1700, myRunId, { realMinMs: 1650 });
  await waitGuessReady(0, myRunId);
  setInput(0, '#guess-input', secret3);
  submitForm(0, '#guess-form');

  await waitFor(() => [0, 1, 2].every((i) => paneStates[i].room?.phase === 'lvScore'), myRunId, 5000, '第3棒 lvScore');
  await waitMs(5200, myRunId);

  // 步骤 9：终局结算、总分榜、称号与逐棒回顾
  await waitFor(() => [0, 1, 2].every((i) => paneStates[i].room?.phase === 'result')
    && q(0, '[data-action="leave"]') && q(1, '[data-review-step="1"]'),
    myRunId, 6000, '终局结算 result');
  setBanner(9, 'R4：终局结算（总分榜 / 竞猜王·最佳描述·神猜 / 逐棒回顾与错词浮窗）', '三屏展示总分榜、三大称号及横向翻页逐棒回顾；玩家 2 自动翻看第 2 棒并展开错词浮窗。');
  await waitMs(1400, myRunId);
  q(1, '[data-review-step="1"]')?.click();
  await waitMs(1200, myRunId);
  q(0, '[data-action="toggle-wrong-popover"]')?.click();
  await waitMs(2200, myRunId);

  // 步骤 10：退出到档案 ?me 并查看历史详情（总分榜 + 称号 + 即时竞猜标签）
  setBanner(10, 'R4/R5：玩家 1 退出到个人档案 ?me → 查看本局历史详情', '验证历史详情页正确显示「共 3 棒」「即时竞猜」及恢复后的「总分榜 + 称号 + 逐棒回顾」（玩家 2/3 保留在结算页对比）。');
  clickEl(0, '[data-action="leave"]');
  await waitFor(() => q(0, '#confirm-modal.is-open [data-action="accept-confirm"]'), myRunId, 4000, '退出确认弹窗');
  clickEl(0, '#confirm-modal [data-action="accept-confirm"]');
  await waitFor(() => !paneStates[0].room && q(0, '.insane-back'), myRunId, 6000, '退出到狂意大厅');
  clickEl(0, '.insane-back');
  await waitFor(() => q(0, '[data-action="open-profile"]'), myRunId, 5000, '回到首页');
  clickEl(0, '[data-action="open-profile"]');
  await waitFor(() => q(0, '.profile-match-link'), myRunId, 6000, '加载对局记录');
  await waitMs(1000, myRunId);
  clickEl(0, '.profile-match-link');
  await waitFor(() => q(0, '.match-detail-page .livonym-result-board'), myRunId, 6000, '历史详情总分榜与称号');

  setBanner(10, '✅ 全流程自动模拟演示完成！', '你现在可以自由滚动/点击任意一屏自行检查显示效果，或点击「演示 2 人残局中断」体验 R3/R5 的残局中断。');
}

async function runInterruptDemo(myRunId) {
  setBanner(0, '残局中断演示：初始化 3 人即时竞猜对局…', '新建 3 人局开局后，玩家 3 主动退出房间，验证剩 2 人自动进入「51 对局中断」。');
  await bootFrames(myRunId);
  clickEl(0, '[data-action="toggle-settings"]');
  await waitMs(200, myRunId);
  clickEl(0, '[data-action="open-insane"]');
  await waitFor(() => q(0, '[data-action="create-insane-room"]'), myRunId, 5000, '狂意大厅');
  clickEl(0, '[data-action="create-insane-room"]');
  await waitFor(() => paneStates[0].room?.phase === 'lobby' && q(0, '[data-action="start"]'), myRunId, 6000, '建房');
  const code = paneStates[0].room.code;
  for (const idx of [1, 2]) {
    setInput(idx, '#room-code', code);
    await waitFor(() => q(idx, '#join-modal.is-open'), myRunId, 5000, '加入弹窗');
    clickEl(idx, '[data-action="confirm-join"]');
    await waitFor(() => paneStates[idx].room?.phase === 'lobby' && q(idx, '[data-action="ready"]'), myRunId, 5000, '入房');
    clickEl(idx, '[data-action="ready"]');
  }
  await waitFor(() => q(0, '[data-action="start"]:not(:disabled)'), myRunId, 5000, '可开始');
  clickEl(0, '[data-action="start"]');
  await waitFor(() => [0, 1, 2].every((i) => paneStates[i].room?.phase === 'lvIntro' || paneStates[i].room?.phase === 'lvPlay')
    && q(2, '[data-action="leave"]'), myRunId, 9000, '进入游戏阶段');
  await waitMs(1200, myRunId);

  setBanner(0, '残局中断演示：玩家 3 主动退出 → 仅剩 2 人触发中断', '正在由玩家 3 点击退出房间…');
  clickEl(2, '[data-action="leave"]');
  await waitFor(() => q(2, '#confirm-modal.is-open [data-action="accept-confirm"]'), myRunId, 4000, '退出确认');
  clickEl(2, '#confirm-modal [data-action="accept-confirm"]');
  await waitFor(() => [0, 1].every((i) => paneStates[i].room?.phase === 'interrupted'), myRunId, 6000, '剩余 2 人进入中断');
  setBanner(0, '✅ 2 人残局中断演示完成！', '玩家 1 与玩家 2 已同步进入「51 对局中断」页（可选择回房间或回主页）。');
}

function setUiRunning(active) {
  running = active;
  btnStart.disabled = active;
  btnPause.disabled = !active;
  btnStep.disabled = !active || !paused;
  btnInterrupt.disabled = active;
}

btnStart.addEventListener('click', async () => {
  const myRunId = ++runId;
  paused = false;
  btnPause.textContent = '暂停';
  setUiRunning(true);
  try {
    await runFullFlow(myRunId);
  } catch (err) {
    if (err?.message !== 'ABORTED') {
      stepBadge.textContent = '异常';
      stepTitle.textContent = `模拟中断：${err.message}`;
    }
  } finally {
    if (myRunId === runId) {
      paused = false;
      btnPause.textContent = '暂停';
      setUiRunning(false);
      btnInterrupt.disabled = false;
    }
  }
});

btnInterrupt.addEventListener('click', async () => {
  const myRunId = ++runId;
  paused = false;
  btnPause.textContent = '暂停';
  setUiRunning(true);
  try {
    await runInterruptDemo(myRunId);
  } catch (err) {
    if (err?.message !== 'ABORTED') {
      stepBadge.textContent = '异常';
      stepTitle.textContent = `模拟中断：${err.message}`;
    }
  } finally {
    if (myRunId === runId) {
      paused = false;
      btnPause.textContent = '暂停';
      setUiRunning(false);
      btnInterrupt.disabled = false;
    }
  }
});

btnPause.addEventListener('click', () => {
  if (!running) return;
  paused = !paused;
  btnPause.textContent = paused ? '继续' : '暂停';
  btnStep.disabled = !paused;
  sendMockAction(0, paused ? 'pause' : 'resume');
  if (!paused && stepResolve) stepResolve();
});

btnStep.addEventListener('click', () => {
  if (!running || !paused || !stepResolve) return;
  stepResolve();
});

btnReset.addEventListener('click', () => {
  const myRunId = ++runId;
  paused = false;
  btnPause.textContent = '暂停';
  setUiRunning(false);
  btnInterrupt.disabled = false;
  setBanner(0, '已重置三屏视角', '点击「开始自动演示」重新走一遍 3 人全流程，或直接在三屏内手动操作。');
  bootFrames(myRunId).catch(() => {});
});

layoutSelect.addEventListener('change', () => {
  trioGrid.classList.toggle('is-mobile', layoutSelect.value === 'mobile');
});

// 初次打开页面自动预热三屏连接
bootFrames(++runId).then(() => {
  btnInterrupt.disabled = false;
}).catch(() => {});
