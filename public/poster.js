// 结算海报：用结算页已有的组件（品牌标识、主题、完整词路径、概览列表）拼出一张
// 固定宽度的 DOM，再通过 SVG + foreignObject 转成 PNG。背景、卡片、词卡与品牌
// 标识的视觉全部来自 styles.css，这里不另写一套。
import { hydrateAvatars } from './avatar.js';
import { brandMarkup, escapeHtml, icon, resultSummary, resultTitle, thoughtPathMarkup, themeMarkup } from './render.js';

const POSTER_WIDTH = 540;
const POSTER_SCALE = 2;
const MAX_PIXEL_HEIGHT = 16000;

let styleCache = null;
let spriteCache = null;

function pad2(value) {
  return String(value).padStart(2, '0');
}

function formatDate(date) {
  return `${date.getFullYear()}.${pad2(date.getMonth() + 1)}.${pad2(date.getDate())}`;
}

function fileStamp(date) {
  return `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}-${pad2(date.getHours())}${pad2(date.getMinutes())}`;
}

function metaMarkup(room) {
  const players = (room.resultPlayers?.length ? room.resultPlayers : room.players) || [];
  const history = Array.isArray(room.history) ? room.history : [];
  const rounds = Number.isInteger(room.maxRounds) ? `第 ${history.length} / ${room.maxRounds} 轮` : `第 ${history.length} 轮`;
  const mode = room.mode === 'theme' ? themeMarkup({ ...room, phase: 'result' }) : '<span>自由联想</span>';
  const items = [`${players.length} 人`, rounds];
  return `<div class="page-heading-meta">${items.map((item) => `<span>${escapeHtml(item)}</span>`).join('')}${mode}</div>`;
}

// 海报正文：品牌行、结论与完整词过程，全部复用结算页的组件。
export function posterMarkup(room, now = new Date()) {
  return `<div class="poster" data-scene="result">
    <header class="poster-head">${brandMarkup()}<span class="poster-date">${escapeHtml(formatDate(now))}</span></header>
    <section class="page-heading result-heading poster-heading"><div class="page-heading-inner">
      <div class="page-heading-copy"><h1>${escapeHtml(resultTitle(room))}</h1><p>${escapeHtml(resultSummary(room))}</p></div>
      ${metaMarkup(room)}
    </div></section>
    <section class="surface-block result-path"><div class="section-heading"><h2>${icon('route')}<span>完整词过程</span></h2></div>
      <div class="result-path-content">${thoughtPathMarkup(room, true)}</div>
    </section>
    <footer class="poster-foot">${brandMarkup()}<p>各自写一个词，同时揭晓，直到想到一起。</p></footer>
  </div>`;
}

async function loadStyles() {
  if (styleCache == null) styleCache = await fetch('/styles.css').then((response) => response.text());
  return styleCache;
}

async function loadSprite() {
  if (spriteCache == null) spriteCache = await fetch('/icons.svg').then((response) => response.text());
  return spriteCache;
}

// 图片里没有外部资源可加载：头像转成 data URL，图标引用改到内联的 sprite。
function inlineAssets(poster) {
  hydrateAvatars(poster);
  for (const use of poster.querySelectorAll('use')) {
    const href = use.getAttribute('href') || '';
    if (href.startsWith('/icons.svg')) use.setAttribute('href', href.slice('/icons.svg'.length));
  }
}

function measure(poster) {
  const holder = document.createElement('div');
  holder.style.cssText = `position: fixed; top: 0; left: -${POSTER_WIDTH * 2}px; width: ${POSTER_WIDTH}px;`;
  holder.append(poster);
  document.body.append(holder);
  const height = Math.ceil(poster.getBoundingClientRect().height);
  return { height, holder };
}

export async function renderPosterCanvas(room, now = new Date()) {
  const [css, sprite] = await Promise.all([loadStyles(), loadSprite()]);
  const wrapper = document.createElement('div');
  wrapper.innerHTML = posterMarkup(room, now);
  const poster = wrapper.firstElementChild;
  inlineAssets(poster);

  const { height, holder } = measure(poster);
  if (!height) {
    holder.remove();
    throw new Error('海报内容为空');
  }
  const xml = new XMLSerializer().serializeToString(poster);
  holder.remove();

  const symbols = sprite.replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${POSTER_WIDTH}" height="${height}">`
    + symbols
    + `<foreignObject width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml">`
    + `<style><![CDATA[${css}]]></style>${xml}</div></foreignObject></svg>`;

  const image = new Image();
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await image.decode();

  const scale = Math.min(POSTER_SCALE, Math.max(0.5, MAX_PIXEL_HEIGHT / height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(POSTER_WIDTH * scale);
  canvas.height = Math.round(height * scale);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('当前环境不支持 Canvas 2D');
  context.scale(scale, scale);
  context.drawImage(image, 0, 0, POSTER_WIDTH, height);
  return canvas;
}

export async function downloadPoster(room, now = new Date()) {
  const canvas = await renderPosterCanvas(room, now);
  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob((value) => (value ? resolve(value) : reject(new Error('海报编码失败'))), 'image/png');
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `synconym-${fileStamp(now)}.png`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
