// WebSocket 安全限流：连接上限、建号限速、消息速率、未握手超时。
// 全部策略集中在 createSecurityPolicy，由 index.js 注入，默认参数对现有测试保持宽松兼容。

import { isIP } from 'node:net';

const DEFAULTS = {
  trustProxy: false,             // 是否信任反向代理的 X-Forwarded-For
  maxGlobalConnections: 1000,
  maxConnectionsPerSource: 50,
  maxAccountsPerSource: 20,
  accountWindowMs: 60_000,
  messageBurst: 60,
  messageRefillPerSecond: 30,
  globalMessageBurst: 1000,
  globalMessageRefillPerSecond: 500,
  handshakeTimeoutMs: 10_000     // 建连后未完成 hello 握手的超时
};

const positive = (value) => Number.isFinite(value) && value > 0 ? value : null;

function createBucket(capacity, refillPerSecond) {
  return {
    capacity,
    refillPerMs: refillPerSecond / 1000,
    tokens: capacity,
    last: Date.now(),
    take() {
      const now = Date.now();
      this.tokens = Math.min(this.capacity, this.tokens + (now - this.last) * this.refillPerMs);
      this.last = now;
      if (this.tokens >= 1) { this.tokens -= 1; return true; }
      return false;
    }
  };
}

export function createSecurityPolicy(config = {}) {
  const options = { ...DEFAULTS, ...config };
  const positiveKeys = ['maxGlobalConnections', 'maxConnectionsPerSource', 'maxAccountsPerSource',
    'accountWindowMs', 'messageBurst', 'messageRefillPerSecond', 'globalMessageBurst', 'globalMessageRefillPerSecond', 'handshakeTimeoutMs'];
  for (const key of positiveKeys) {
    const value = positive(options[key]);
    if (value === null) throw new TypeError(`security.${key} 必须为正数`);
    options[key] = value;
  }
  options.trustProxy = Boolean(options.trustProxy);

  let connections = 0;
  const perSource = new Map();          // ip -> 数量（活跃连接）
  const accounts = new Map();           // ip -> 时间戳数组（窗口内建号）
  const globalBucket = createBucket(options.globalMessageBurst, options.globalMessageRefillPerSecond);

  const prune = () => {
    for (const [ip, count] of perSource) if (count <= 0) perSource.delete(ip);
    const cutoff = Date.now() - options.accountWindowMs;
    for (const [ip, stamps] of accounts) {
      const kept = stamps.filter((t) => t > cutoff);
      if (kept.length) accounts.set(ip, kept); else accounts.delete(ip);
    }
  };
  const pruner = setInterval(prune, options.accountWindowMs);
  pruner.unref();

  return {
    options,
    // 仅在后端只能被受信代理访问时启用；最右项必须由代理追加或覆盖。
    ipOf(request, socket) {
      if (options.trustProxy) {
        const forwarded = request.headers['x-forwarded-for'];
        const candidate = typeof forwarded === 'string' ? forwarded.split(',').at(-1).trim() : '';
        if (isIP(candidate)) return candidate.startsWith('::ffff:') ? candidate.slice(7) : candidate;
      }
      const address = socket.remoteAddress || 'unknown';
      return address.startsWith('::ffff:') ? address.slice(7) : address;
    },
    tryAcquireConnection(ip) {
      if (connections >= options.maxGlobalConnections) return false;
      const current = perSource.get(ip) || 0;
      if (current >= options.maxConnectionsPerSource) return false;
      perSource.set(ip, current + 1);
      connections += 1;
      return true;
    },
    releaseConnection(ip) {
      const current = perSource.get(ip);
      if (current === undefined) return;
      if (current <= 1) perSource.delete(ip); else perSource.set(ip, current - 1);
      connections = Math.max(0, connections - 1);
    },
    connectionCount() { return connections; },
    sourceCount(ip) { return perSource.get(ip) || 0; },
    // 匿名建号：滑动窗口计数
    allowAccount(ip) {
      const now = Date.now();
      const cutoff = now - options.accountWindowMs;
      const stamps = (accounts.get(ip) || []).filter((t) => t > cutoff);
      if (stamps.length >= options.maxAccountsPerSource) { accounts.set(ip, stamps); return false; }
      stamps.push(now);
      accounts.set(ip, stamps);
      return true;
    },
    accountCount(ip) {
      const cutoff = Date.now() - options.accountWindowMs;
      return (accounts.get(ip) || []).filter((t) => t > cutoff).length;
    },
    createMessageBucket() { return createBucket(options.messageBurst, options.messageRefillPerSecond); },
    tryAcquireGlobalMessage() { return globalBucket.take(); },
    close() { clearInterval(pruner); }
  };
}
