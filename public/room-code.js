export function parseRoomCode(value) {
  const input = String(value || '').trim().replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xFEE0));
  if (/^[0-9]{5}$/.test(input)) return input;
  try {
    const url = new URL(input);
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    const codes = url.searchParams.getAll('r');
    return codes.length === 1 && /^[0-9]{5}$/.test(codes[0]) ? codes[0] : '';
  } catch {
    return '';
  }
}

export function sanitizeNumericInput(value, length) {
  return String(value || '').replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xFEE0))
    .replace(/[^0-9]/g, '').slice(0, length);
}

export function sanitizeRoomInput(value) {
  return sanitizeNumericInput(value, 5);
}
