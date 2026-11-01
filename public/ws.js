export class Socket {
  constructor({ onHello, onState, onError, onToast }) {
    this.handlers = { onHello, onState, onError, onToast };
    this.uid = localStorage.getItem('sy_uid') || '';
    this.roomCode = new URLSearchParams(location.search).get('r') || '';
    this.queue = [];
    this.closed = false;
    this.reconnectDelay = 500;
    this.connect();
  }

  connect() {
    this.ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
    this.ws.addEventListener('open', () => {
      this.reconnectDelay = 500;
      this.send({ type: 'hello', uid: this.uid || undefined, roomCode: this.roomCode || undefined }, true);
      for (const message of this.queue.splice(0)) this.send(message, true);
    });
    this.ws.addEventListener('message', ({ data }) => {
      const message = JSON.parse(data);
      if (message.type === 'hello') {
        this.uid = message.uid;
        localStorage.setItem('sy_uid', this.uid);
        document.cookie = `sy_uid=${this.uid}; max-age=2592000; path=/; samesite=lax`;
        this.handlers.onHello?.(message);
      } else if (message.type === 'state') {
        this.handlers.onState?.(message);
      } else if (message.type === 'error') {
        this.handlers.onError?.(message.message);
      } else if (message.type === 'toast') {
        this.handlers.onToast?.(message.message);
      }
    });
    this.ws.addEventListener('close', () => {
      if (this.closed) return;
      setTimeout(() => this.connect(), this.reconnectDelay);
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, 5000);
    });
  }

  send(message, immediate = false) {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(message));
    else if (!immediate) this.queue.push(message);
  }
}
