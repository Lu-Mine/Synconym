import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// data/vectors/ 的文件格式，由 scripts/build-vectors.js 生成：
// vocab.json   归一化后的词，下标即行号
// vectors.bin  Int8Array，行优先，count 行 × dim 列；每行先 L2 归一化，再乘 scale 取整
// meta.json    { dim, count, scale, calib: { lo, hi }, builtAt }
export const VECTOR_DIR = fileURLToPath(new URL('../data/vectors', import.meta.url));

export function loadVectors(dir = VECTOR_DIR) {
  const meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8'));
  const vocab = JSON.parse(readFileSync(join(dir, 'vocab.json'), 'utf8'));
  const buffer = readFileSync(join(dir, 'vectors.bin'));
  const vectors = new Int8Array(buffer.buffer, buffer.byteOffset, buffer.length);
  const { dim, count, scale, calib } = meta;
  if (!Number.isInteger(dim) || dim < 1 || !Array.isArray(vocab) || vocab.length !== count
    || vectors.length !== dim * count || !(scale > 0) || !(calib?.hi > calib?.lo)) {
    throw new Error('词向量文件不完整或互不匹配');
  }
  return { vocab, vectors, dim, scale, calib, builtAt: meta.builtAt ?? null };
}

// 两行的余弦：int8 点积除以 scale²（行已归一化，量化误差约 0.002）
export function cosine({ vectors, dim, scale }, x, y) {
  let dot = 0;
  for (let i = 0, p = x * dim, q = y * dim; i < dim; i += 1) dot += vectors[p + i] * vectors[q + i];
  return dot / (scale * scale);
}
