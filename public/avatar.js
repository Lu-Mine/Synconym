// 头像的位图渲染与填充：页面与结算海报共用同一套调色板与绘制方式。
import { avatarDetails } from './render.js';

const AVATAR_PALETTE = [
  { ink: '#3154C7', bg: '#E8EEFF' },
  { ink: '#B94735', bg: '#FFF0EC' },
  { ink: '#187A61', bg: '#E8F8F1' },
  { ink: '#7447B8', bg: '#F3ECFF' }
];

const avatarImageCache = new Map();

export function avatarImageUrl(name) {
  const normalizedName = String(name || '').trim();
  if (avatarImageCache.has(normalizedName)) return avatarImageCache.get(normalizedName);
  const { initial, tone } = avatarDetails(normalizedName);
  const palette = AVATAR_PALETTE[tone];
  const canvas = document.createElement('canvas');
  const size = 152;
  const radius = 44;
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');

  context.beginPath();
  context.roundRect(0, 0, size, size, radius);
  context.fillStyle = palette.bg;
  context.fill();

  context.fillStyle = palette.ink;
  context.font = '680 60px system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
  context.textAlign = 'left';
  context.textBaseline = 'alphabetic';
  const glyph = initial.toUpperCase();
  const metrics = context.measureText(glyph);
  const inkLeft = metrics.actualBoundingBoxLeft;
  const inkRight = metrics.actualBoundingBoxRight;
  const inkTop = metrics.actualBoundingBoxAscent;
  const inkBottom = metrics.actualBoundingBoxDescent;
  const x = (size + inkLeft - inkRight) / 2;
  const y = (size + inkTop - inkBottom) / 2;
  context.fillText(glyph, x, y);

  const url = canvas.toDataURL('image/png');
  avatarImageCache.set(normalizedName, url);
  return url;
}

export function hydrateAvatars(root = document) {
  for (const avatar of root.querySelectorAll('img.avatar[data-avatar-name]')) {
    const name = avatar.dataset.avatarName || '';
    if (avatar.dataset.renderedName === name) continue;
    avatar.src = avatarImageUrl(name);
    avatar.dataset.renderedName = name;
  }
}
