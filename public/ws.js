export class Socket {
  constructor({ onHello, onState, onError, onToast, onConnection }) {
    this.handlers = { onHello, onState, onError, onToast, onConnection };
    this.uid = localStorage.getItem('sy_uid') || '';
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
      this.reconnectDelay = 500;
      this.send({ type: 'hello', uid: this.uid || undefined, roomCode: this.pendingLeave || this.roomCode || undefined, leaveRoom: Boolean(this.pendingLeave) }, true);
    });
    ws.addEventListener('message', ({ data }) => {
      if (this.ws !== ws) return;
      const message = JSON.parse(data);
      if (message.type === 'hello') {
        this.uid = message.uid;
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
        this.handlers.onConnection?.('connected');
        this.hadState = true;
        this.handlers.onState?.(message);
        for (const item of this.queue.splice(0)) this.send(item);
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
      this.handlers.onConnection?.('disconnected');
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
