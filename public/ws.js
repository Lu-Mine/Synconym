export class Socket {
  constructor({ onHello, onState, onProfile, onMatchDetail, onIdentity, onError, onToast, onConnection }) {
    this.handlers = { onHello, onState, onProfile, onMatchDetail, onIdentity, onError, onToast, onConnection };
    let identity;
    try { identity = JSON.parse(localStorage.getItem('sy_identity')); } catch { /* 无效的本地身份 */ }
    this.uid = typeof identity?.uid === 'string' && typeof identity?.credential === 'string' ? identity.uid : '';
    this.credential = this.uid ? identity.credential : '';
    this.roomCode = new URLSearchParams(location.search).get('r') || '';
    this.pendingLeave = sessionStorage.getItem('sy_pending_leave') || '';
    this.queue = [];
    this.closed = false;
    this.ready = false;
    this.reconnectDelay = 500;
    this.connect();
  }

  connect() {
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
    this.ws = ws;
    ws.addEventListener('open', () => {
      this.send({ type: 'hello', uid: this.uid || undefined, credential: this.credential || undefined, roomCode: this.pendingLeave || this.roomCode || undefined, leaveRoom: Boolean(this.pendingLeave) }, true);
    });
    ws.addEventListener('message', ({ data }) => {
      if (this.ws !== ws) return;
      const message = JSON.parse(data);
      if (message.type === 'hello') {
        this.uid = message.uid;
        if (message.credential) {
          this.credential = message.credential;
          localStorage.setItem('sy_identity', JSON.stringify({ uid: this.uid, credential: this.credential }));
        }
        localStorage.setItem('sy_uid', this.uid);
        document.cookie = `sy_uid=${this.uid}; max-age=2592000; path=/; samesite=lax`;
        if (this.pendingLeave && message.restored) {
          this.send({ type: 'leave' }, true);
          return;
        }
        if (this.pendingLeave) { this.clearLeave(); this.roomCode = ''; return; }
        if (this.hadState && !message.restored) this.roomCode = '';
        this.handlers.onHello?.(message);
      } else if (message.type === 'state') {
        if (this.pendingLeave && message.room) return;
        if (!message.room) this.clearLeave();
        this.ready = true;
        this.reconnectDelay = 500;
        this.handlers.onConnection?.('connected');
        this.hadState = true;
        this.handlers.onState?.(message);
        for (const item of this.queue.splice(0)) this.send(item);
      } else if (message.type === 'profile') {
        this.handlers.onProfile?.(message.profile);
      } else if (message.type === 'matchDetail') {
        this.handlers.onMatchDetail?.(message);
      } else if (message.type === 'identity') {
        // 我是新人：换掉本地身份，后续重连与请求都用新 uid。
        this.uid = message.uid;
        this.credential = message.credential || '';
        if (this.credential) localStorage.setItem('sy_identity', JSON.stringify({ uid: this.uid, credential: this.credential }));
        localStorage.setItem('sy_uid', this.uid);
        document.cookie = `sy_uid=${this.uid}; max-age=2592000; path=/; samesite=lax`;
        this.handlers.onIdentity?.(message);
      } else if (message.type === 'error') {
        this.handlers.onError?.(message.message);
      } else if (message.type === 'toast') {
        this.handlers.onToast?.(message.message);
      }
    });
    ws.addEventListener('close', (event) => {
      if (this.ws !== ws) return;
      this.ready = false;
      this.queue.length = 0;
      if (event.code === 4001) {
        this.closed = true;
        this.handlers.onConnection?.('replaced');
        return;
      }
      if (event.code === 4003) {
        this.closed = true;
        this.handlers.onConnection?.('auth-failed');
        return;
      }
      this.handlers.onConnection?.(event.code === 4002 ? 'uid-in-use' : 'disconnected');
      if (this.closed) return;
      setTimeout(() => this.connect(), this.reconnectDelay);
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, 5000);
    });
  }

  clearLeave() {
    this.pendingLeave = '';
    sessionStorage.removeItem('sy_pending_leave');
  }

  send(message, immediate = false) {
    if (message.type === 'leave') {
      this.pendingLeave = this.roomCode;
      if (this.pendingLeave) sessionStorage.setItem('sy_pending_leave', this.pendingLeave);
      this.queue.length = 0;
    }
    if (this.ws.readyState === WebSocket.OPEN && (immediate || this.ready)) {
      this.ws.send(JSON.stringify(message));
      return true;
    }
    // 只排队显式加入；游玩操作不可在重连后重放到另一个阶段。
    if (message.type === 'joinRoom') this.queue.push(message);
    return false;
  }
}
