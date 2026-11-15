// 头像的位图渲染与填充：调色板与绘制方式统一在这里。
import { avatarDetails } from './render.js';

const AVATAR_PALETTE = [
  { ink: '#3154C7', bg: '#E8EEFF' },
  { ink: '#B94735', bg: '#FFF0EC' },
  { ink: '#187A61', bg: '#E8F8F1' },
  { ink: '#7447B8', bg: '#F3ECFF' }
];

// 已注销的身份：灰底灰字，字形固定是一条斜杠，和任何昵称都不重样。
const DELETED_PALETTE = Object.freeze({ ink: '#8A8A8E', bg: '#EDEDF0' });
const DELETED_GLYPH = '/';

const avatarImageCache = new Map();

export function avatarImageUrl(name, deleted = false) {
  const normalizedName = String(name || '').trim();
  const cacheKey = `${deleted ? '/' : ''}${normalizedName}`;
  if (avatarImageCache.has(cacheKey)) return avatarImageCache.get(cacheKey);
  const { initial, tone } = avatarDetails(normalizedName);
  const palette = deleted ? DELETED_PALETTE : AVATAR_PALETTE[tone];
  const glyph = deleted ? DELETED_GLYPH : initial.toUpperCase();
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
  const metrics = context.measureText(glyph);
  const inkLeft = metrics.actualBoundingBoxLeft;
  const inkRight = metrics.actualBoundingBoxRight;
  const inkTop = metrics.actualBoundingBoxAscent;
  const inkBottom = metrics.actualBoundingBoxDescent;
  const x = (size + inkLeft - inkRight) / 2;
  const y = (size + inkTop - inkBottom) / 2;
  context.fillText(glyph, x, y);

  const url = canvas.toDataURL('image/png');
  avatarImageCache.set(cacheKey, url);
  return url;
}

export function hydrateAvatars(root = document) {
  for (const avatar of root.querySelectorAll('img.avatar[data-avatar-name]')) {
    const name = avatar.dataset.avatarName || '';
    const deleted = avatar.dataset.avatarDeleted === 'true';
    const key = `${deleted ? '/' : ''}${name}`;
    if (avatar.dataset.renderedName === key) continue;
    avatar.src = avatarImageUrl(name, deleted);
    avatar.dataset.renderedName = key;
  }
}
