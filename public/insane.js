import { icon, wordmarkArt } from './render.js';

// 这些玩法尚未接入服务端，页面只展示设计中的规则。
const modes = [
  {
    id: 'blitz', name: '极速闪电', english: 'Blitz', players: '2 人',
    lead: '不要停，凭直觉想到一起。',
    description: '每轮输入 8 秒，揭晓 3 秒，随后自动开始下一轮。不用提交、准备或投票，只管打字，以尽可能短的时间写出完全一致的答案。'
  },
  {
    id: 'livonym', name: '即时竞猜', english: 'Livonym', players: '3–8 人', ready: true,
    lead: '看着想法出现，抢先猜中答案。',
    description: '一人实时打字描述秘密词，其他人限时竞猜。文字输入即刻展现，无需提交；按猜中先后得分，轮流出题，最后以总分排名。'
  },
  {
    id: 'shiritori', name: '接龙', english: 'Shiritori', players: '2–4 人',
    lead: '沿着词尾，继续靠近。',
    description: '每轮从大家的答案末尾抽取一个公共首字，下一轮的词都要从这里开始。可以选择严格接字，或按拼音接龙；在约束中找到同一个答案。'
  },
  {
    id: 'impostor', name: '思维卧底', english: 'Impostor', players: '3–6 人',
    lead: '有人在靠近，也有人在带偏。',
    description: '写词、相遇、观察彼此的选择：延长的投票会公开每位玩家的意见。最后找出藏在其中的卧底；六人局里会有两名卧底。'
  },
  {
    id: 'bridge', name: '语义搭桥', english: 'Bridge', players: '2–4 人',
    lead: '从不同的起点，走向同一个词。',
    description: '每个人从系统给出的不同起点出发，观察所有人的词，逐轮联想、搭桥、靠近，直到大家相遇。'
  }
];
export const INSANE_DEFAULT_MODE = modes[0].id;

function resolveMode(modeId) {
  const id = typeof modeId === 'object' && modeId !== null ? (modeId.currentMode || modeId.mode || modeId.id) : modeId;
  return modes.find((mode) => mode.id === id) || modes.find((mode) => mode.id === INSANE_DEFAULT_MODE) || modes[0];
}

export function insanePreviewBodyMarkup(modeId = INSANE_DEFAULT_MODE) {
  const mode = resolveMode(modeId);
  return `<div class="insane-preview-head">
      <span class="insane-mark insane-mark--${mode.id}" aria-hidden="true"><i></i><i></i><i></i></span>
      <div class="insane-preview-title">
        <span class="insane-wordmark insane-wordmark--${mode.id}" lang="en"><span class="sr-only">${mode.english}</span><span class="wordmark-art" aria-hidden="true">${wordmarkArt[mode.id]}</span></span>
        <strong>${mode.name}</strong>
      </div>
      <span class="insane-players">${icon('users')}<span>${mode.players}</span></span>
    </div>
    <div class="insane-preview-body">
      <h3 class="insane-preview-lead">${mode.lead}</h3>
      <p class="insane-preview-desc">${mode.description}</p>
    </div>`;
}

export function insanePreviewMarkup(modeId = INSANE_DEFAULT_MODE) {
  const mode = resolveMode(modeId);
  return `<aside class="insane-preview insane-preview--${mode.id}" data-mode="${mode.id}" aria-label="玩法介绍" aria-live="polite"><canvas class="insane-preview-canvas" aria-hidden="true"></canvas>${insanePreviewBodyMarkup(mode.id)}</aside>`;
}

export function insaneMarkup(selectedMode = INSANE_DEFAULT_MODE) {
  const active = resolveMode(selectedMode);
  const cards = modes.map((mode) => `<article class="insane-card insane-card--${mode.id}">
    <canvas class="insane-card-canvas" aria-hidden="true"></canvas>
    <details class="insane-details">
      <summary class="insane-card-row">
        <span class="insane-mark insane-mark--${mode.id}" aria-hidden="true"><i></i><i></i><i></i></span>
        <span class="insane-card-title"><span class="insane-wordmark insane-wordmark--${mode.id}" lang="en"><span class="sr-only">${mode.english}</span><span class="wordmark-art" aria-hidden="true">${wordmarkArt[mode.id]}</span></span><strong>${mode.name}</strong></span>
        <span class="insane-players">${icon('users')}<span>${mode.players}</span></span>
        <span class="insane-disclosure" aria-hidden="true">${icon('chevron-down')}</span>
      </summary>
      <div class="insane-description"><h3>${mode.lead}</h3><p>${mode.description}</p></div>
    </details>
    ${mode.ready
      ? `<button class="insane-create" type="button" data-action="create-insane-room" data-mode="${mode.id}" aria-label="用${mode.name}创建房间"><span>创建房间</span></button>`
      : `<button class="insane-create" type="button" disabled aria-label="${mode.name}创建房间，暂未开放"><span>创建房间</span></button>`}
  </article>`).join('');
  return `<div class="page insane-page" data-screen="insane">
    <a class="insane-back" href="/" data-action="home">${icon('arrow-left')}<span>返回主页</span></a>
    <header class="insane-heading">
      <div><h1><span class="insane-heading-en" lang="en"><span class="sr-only">INSANE</span>${wordmarkArt.insane}</span><span class="insane-heading-zh insane-heading-text" data-glow="狂意模式">狂意模式</span></h1><p class="insane-intro">让想法，走点不一样的路。</p></div>
      <span class="insane-heading-mark" aria-hidden="true"><i></i><i></i></span>
    </header>
    <div class="insane-list-heading"><h2>选择一种玩法</h2>${modes.some((mode) => !mode.ready) ? '<p>其余玩法仍在筹备中</p>' : ''}</div>
    <div class="insane-layout" data-selected="${active.id}" data-preview="${active.id}">
      <section class="insane-list" aria-label="狂意玩法列表">${cards}</section>
      ${insanePreviewMarkup(active.id)}
    </div>
  </div>`;
}
