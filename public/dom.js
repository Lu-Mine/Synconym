// 同场景补丁：复用已有节点，不通过 innerHTML 重建活动界面。
function key(node) {
  if (node.nodeType !== 1) return null;
  return node.id ? `id:${node.id}` : node.getAttribute('data-uid') ? `uid:${node.getAttribute('data-uid')}`
    : node.getAttribute('data-action') ? `action:${node.getAttribute('data-action')}` : null;
}

function compatible(a, b) {
  return a.nodeType === b.nodeType && (a.nodeType !== 1 || (a.tagName === b.tagName && key(a) === key(b)));
}

function patchNode(current, next) {
  if (current.nodeType !== 1) {
    if (current.nodeValue !== next.nodeValue) current.nodeValue = next.nodeValue;
    return;
  }
  for (const attribute of [...current.attributes]) {
    // open 属于用户的展开状态；头像 src 与渲染缓存由 hydrateAvatars 管理。
    if ((current.tagName === 'DETAILS' && attribute.name === 'open')
      || (current.matches('img.avatar') && ['src', 'data-rendered-name'].includes(attribute.name))) continue;
    if (!next.hasAttribute(attribute.name)) current.removeAttribute(attribute.name);
  }
  for (const attribute of [...next.attributes]) {
    const value = attribute.name === 'class' && current.classList?.contains('vt-managed')
      ? `${attribute.value} vt-managed` : attribute.value;
    if (current.getAttribute(attribute.name) !== value) current.setAttribute(attribute.name, value);
  }
  patchChildren(current, next);
}

export function patchChildren(current, next) {
  let cursor = current.firstChild;
  for (const desired of [...next.childNodes]) {
    if (cursor && compatible(cursor, desired)) {
      patchNode(cursor, desired);
      cursor = cursor.nextSibling;
      continue;
    }
    // 有稳定标识的节点即使换位也复用，避免焦点与组件状态丢失。
    const desiredKey = key(desired);
    const existing = desiredKey ? [...current.childNodes].find((node) => compatible(node, desired)) : null;
    if (existing) {
      current.insertBefore(existing, cursor);
      patchNode(existing, desired);
    } else {
      current.insertBefore(desired.cloneNode(true), cursor);
    }
  }
  while (cursor) {
    const following = cursor.nextSibling;
    current.removeChild(cursor);
    cursor = following;
  }
}

export function patchMarkup(element, markup) {
  const template = element.ownerDocument.createElement('template');
  template.innerHTML = markup;
  patchChildren(element, template.content);
}
