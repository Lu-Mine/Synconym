import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const names = [
  'plus', 'minus', 'check', 'x', 'copy', 'settings', 'user', 'log-out',
  'clock', 'play', 'users', 'chevron-down', 'rotate-ccw',
  'arrow-right', 'arrow-down', 'route', 'pen-line', 'sliders-horizontal',
  'sparkles', 'book-open', 'lightbulb', 'tag', 'hash', 'shield-check', 'clipboard-paste', 'circle-help',
  'door-open', 'chart-line', 'download', 'vote'
];
const symbols = await Promise.all(names.map(async (name) => {
  const svg = await readFile(resolve('node_modules/lucide-static/icons', `${name}.svg`), 'utf8');
  const content = svg.replace(/<!--[\s\S]*?-->/g, '').trim()
    .replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
  return `<symbol id="icon-${name}" viewBox="0 0 24 24">${content}</symbol>`;
}));
await writeFile(resolve('public/icons.svg'),
  `<svg xmlns="http://www.w3.org/2000/svg">${symbols.join('')}</svg>\n`);
console.log(`Generated ${names.length} Lucide icons.`);
