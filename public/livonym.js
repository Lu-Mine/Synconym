// 即时竞猜的输入清洗：只挡「不能写」的，不挡「怎么写」。
export const DESCRIBE_LIMIT = 50;

const INVISIBLE = /[\p{Cc}\u200b\u200c\ufeff]/u;
// \p{Cc} 含换行与制表符：换行要保留，其余控制字符剔除
const keepChar = (char) => char === '\n' || !INVISIBLE.test(char);

// 保留标点、emoji 与换行；行内连续空白折叠成一个空格，连续空行折叠成一行。
export function cleanDescribe(value, limit = DESCRIBE_LIMIT) {
  const flat = [...String(value).normalize('NFC')].filter(keepChar).join('');
  const folded = flat.replace(/[^\S\n]+/gu, ' ').replace(/\n{2,}/gu, '\n');
  return [...folded].slice(0, limit).join('');
}

// 与服务端 normalizeWord 对齐（繁简差异交给服务端兜底）：全角转半角、去空白、小写。
export function normalizeForSecret(value) {
  return String(value).normalize('NFC')
    .replace(/[！-～]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xFEE0))
    .replace(/\s/gu, '').toLowerCase();
}

// 出题人知道谜底，本地先拦一次：命中就不发送，零延迟也不占带宽。
export function describeContainsSecret(text, secret) {
  const target = normalizeForSecret(secret ?? '');
  if (target.length < 2) return false;
  return normalizeForSecret(text).includes(target);
}
