import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { patchChildren } from '../../public/dom.js';

// 覆盖补丁使用的 DOM 协议，无需引入浏览器运行时依赖。
class Node {
  constructor(tagName, attrs = {}, children = []) {
    this.nodeType = tagName ? 1 : 3;
    this.tagName = tagName;
    this.values = new Map(Object.entries(attrs));
    this.childNodes = [];
    for (const child of children) this.insertBefore(child, null);
  }
  get id() { return this.getAttribute('id'); }
  get attributes() { return [...this.values].map(([name, value]) => ({ name, value })); }
  get firstChild() { return this.childNodes[0] || null; }
  get nextSibling() { return this.parentNode?.childNodes[this.parentNode.childNodes.indexOf(this) + 1] || null; }
  getAttribute(name) { return this.values.get(name) ?? null; }
  hasAttribute(name) { return this.values.has(name); }
  setAttribute(name, value) { this.values.set(name, value); }
  removeAttribute(name) { this.values.delete(name); }
  matches(selector) { return selector === 'img.avatar' && this.tagName === 'IMG' && this.getAttribute('class') === 'avatar'; }
  insertBefore(node, cursor) {
    if (node === cursor) return node;
    node.parentNode?.removeChild(node);
    const at = cursor ? this.childNodes.indexOf(cursor) : this.childNodes.length;
    assert.ok(at >= 0);
    this.childNodes.splice(at, 0, node); node.parentNode = this;
    return node;
  }
  removeChild(node) { this.childNodes.splice(this.childNodes.indexOf(node), 1); node.parentNode = null; }
  cloneNode() { const copy = new Node(this.tagName, Object.fromEntries(this.values), this.childNodes.map((n) => n.cloneNode())); copy.nodeValue = this.nodeValue; return copy; }
}
const text = (value) => Object.assign(new Node(null), { nodeValue: value });
const el = (tag, attrs, children) => new Node(tag, attrs, children);

test('同场景按钮更新保留节点，只修改禁用状态和文字', () => {
  const button = el('BUTTON', { 'data-action': 'vote-yes' }, [text('是')]);
  const root = el('DIV', {}, [button]);
  patchChildren(root, el('DIV', {}, [el('BUTTON', { 'data-action': 'vote-yes', disabled: '' }, [text('已投票')])]));
  assert.equal(root.firstChild, button);
  assert.equal(button.firstChild.nodeValue, '已投票');
  assert.ok(button.hasAttribute('disabled'));
});

test('输入值、展开状态、头像缓存及滚动等运行时状态不丢失', () => {
  const input = el('INPUT', { id: 'word' }); input.value = '正在输入';
  const details = el('DETAILS', { open: '' }, [text('投票记录')]);
  const avatar = el('IMG', { class: 'avatar', src: 'data:image/png;base64,test', 'data-rendered-name': '甲' });
  const root = el('DIV', {}, [input, details, avatar]); root.scrollTop = 180;
  patchChildren(root, el('DIV', {}, [el('INPUT', { id: 'word' }), el('DETAILS', {}, [text('投票记录')]), el('IMG', { class: 'avatar' })]));
  assert.equal(root.firstChild, input); assert.equal(input.value, '正在输入');
  assert.ok(details.hasAttribute('open')); assert.equal(avatar.getAttribute('src'), 'data:image/png;base64,test');
  assert.equal(root.scrollTop, 180);
});

test('按 UID 复用玩家节点，支持换位、新增和删除', () => {
  const a = el('LI', { 'data-uid': 'a' }, [text('甲')]);
  const b = el('LI', { 'data-uid': 'b' }, [text('乙')]);
  const root = el('UL', {}, [a, b]);
  patchChildren(root, el('UL', {}, [el('LI', { 'data-uid': 'b' }, [text('乙新名字')]), el('LI', { 'data-uid': 'c' }, [text('丙')])]));
  assert.equal(root.firstChild, b); assert.equal(b.firstChild.nodeValue, '乙新名字');
  assert.equal(root.childNodes.length, 2); assert.equal(root.childNodes[1].getAttribute('data-uid'), 'c');
  assert.equal(a.parentNode, null);
});

test('同场景分支覆盖投票、准备和结算；实际页面不使用 innerHTML 重建这些区块', () => {
  const source = readFileSync(new URL('../../public/app.js', import.meta.url), 'utf8');
  assert.match(source, /nextScreen === 'voting' \|\| nextScreen === 'prepare'/);
  assert.match(source, /patchMarkup\(stage, writingMarkup\(state, gameUi\)\)/);
  assert.match(source, /patchMarkup\(panel, rematchMarkup\(state\)\)/);
  assert.doesNotMatch(source, /(?:panel|list|oldStatus|oldPrevious|content)\.innerHTML\s*=/);
  assert.match(source, /dataset\.round === String\(state\.room\.round\)/);
});

test('同场景更新保留过场完成标记，不重新播放整页入场动画', () => {
  const page = el('DIV', { class: 'page vt-managed' });
  page.classList = { contains: (name) => page.getAttribute('class').split(' ').includes(name) };
  const root = el('DIV', {}, [page]);
  patchChildren(root, el('DIV', {}, [el('DIV', { class: 'page' })]));
  assert.equal(root.firstChild, page);
  assert.equal(page.getAttribute('class'), 'page vt-managed');
});
