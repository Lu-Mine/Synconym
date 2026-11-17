export class Socket {
  constructor({ device = null, onHello, onState, onProfile, onMatchDetail, onIdentity, onError, onToast, onConnection,
    onDeviceCandidates, onRemovedMatches, onLivonymStream, onLivonymGuessResult, onLivonymGuessed, onLivonymBlocked }) {
    this.handlers = { onHello, onState, onProfile, onMatchDetail, onIdentity, onError, onToast, onConnection,
      onDeviceCandidates, onRemovedMatches, onLivonymStream, onLivonymGuessResult, onLivonymGuessed, onLivonymBlocked };
    this.device = device;
    this.mock = Boolean(globalThis.__SYNCONYM_MOCK__);
    const slot = this.mock ? (new URLSearchParams(location.search).get('slot') || '') : '';
    this.slot = slot;
    const suffix = slot ? `_${slot}` : '';
    this.identityKey = (this.mock ? 'sy_mock_identity' : 'sy_identity') + suffix;
    this.uidKey = (this.mock ? 'sy_mock_uid' : 'sy_uid') + suffix;
    this.leaveKey = (this.mock ? 'sy_mock_pending_leave' : 'sy_pending_leave') + suffix;
    let identity;
    try { identity = JSON.parse((this.mock ? sessionStorage : localStorage).getItem(this.identityKey)); } catch { /* 无效的本地身份 */ }
    this.uid = typeof identity?.uid === 'string' && typeof identity?.credential === 'string' ? identity.uid : '';
    this.credential = this.uid ? identity.credential : '';
    this.roomCode = new URLSearchParams(location.search).get('r') || '';
    this.pendingLeave = sessionStorage.getItem(this.leaveKey) || '';
    this.queue = [];
    this.closed = false;
    this.ready = false;
    this.reconnectDelay = 500;
    this.connect();
  }

  connect() {
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${this.mock ? '/__mock/ws' : '/ws'}`);
    let awaitingInitialState = true;
    this.ws = ws;
    ws.addEventListener('open', () => {
      this.send({
        type: 'hello', uid: this.uid || undefined, credential: this.credential || undefined,
        device: this.slot ? undefined : (this.device || undefined),
        roomCode: this.pendingLeave || this.roomCode || undefined, leaveRoom: Boolean(this.pendingLeave)
      }, true);
    });
    ws.addEventListener('message', ({ data }) => {
      if (this.ws !== ws) return;
      const message = JSON.parse(data);
      if (message.type === 'hello') {
        this.uid = message.uid;
        // 设备上还有别的身份时服务端会下发候选，交给界面确认，这里不自动切换。
        if (message.deviceCandidates) this.handlers.onDeviceCandidates?.(message.deviceCandidates);
        if (message.credential) {
          this.credential = message.credential;
          (this.mock ? sessionStorage : localStorage).setItem(this.identityKey, JSON.stringify({ uid: this.uid, credential: this.credential }));
        }
        (this.mock ? sessionStorage : localStorage).setItem(this.uidKey, this.uid);
        if (!this.mock) document.cookie = `sy_uid=${this.uid}; max-age=2592000; path=/; samesite=lax`;
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
        const initialSync = awaitingInitialState;
        awaitingInitialState = false;
        this.hadState = true;
        this.handlers.onState?.(message, { initialSync });
        for (const item of this.queue.splice(0)) this.send(item);
      } else if (message.type === 'profile') {
        this.handlers.onProfile?.(message.profile);
      } else if (message.type === 'matchDetail') {
        this.handlers.onMatchDetail?.(message);
      } else if (message.type === 'identity') {
        // 我是新人：换掉本地身份，后续重连与请求都用新 uid。
        this.uid = message.uid;
        this.credential = message.credential || '';
        if (this.credential) (this.mock ? sessionStorage : localStorage).setItem(this.identityKey, JSON.stringify({ uid: this.uid, credential: this.credential }));
        (this.mock ? sessionStorage : localStorage).setItem(this.uidKey, this.uid);
        if (!this.mock) document.cookie = `sy_uid=${this.uid}; max-age=2592000; path=/; samesite=lax`;
        this.handlers.onIdentity?.(message);
      } else if (message.type === 'removedMatches') {
        this.handlers.onRemovedMatches?.(message.removed);
      } else if (message.type === 'error') {
        this.handlers.onError?.(message.message);
      } else if (message.type === 'livonymStream') {
        this.handlers.onLivonymStream?.(message);
      } else if (message.type === 'livonymGuessResult') {
        this.handlers.onLivonymGuessResult?.(message);
      } else if (message.type === 'livonymGuessed') {
        this.handlers.onLivonymGuessed?.(message);
      } else if (message.type === 'livonymBlocked') {
        this.handlers.onLivonymBlocked?.(message);
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
        if (this.mock) {
          sessionStorage.removeItem(this.identityKey);
          sessionStorage.removeItem(this.uidKey);
          sessionStorage.removeItem(this.leaveKey);
          this.uid = ''; this.credential = ''; this.roomCode = ''; this.pendingLeave = '';
          setTimeout(() => this.connect(), 100);
          return;
        }
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
    sessionStorage.removeItem(this.leaveKey);
  }

  send(message, immediate = false) {
    if (message.type === 'leave') {
      this.pendingLeave = this.roomCode;
      if (this.pendingLeave) sessionStorage.setItem(this.leaveKey, this.pendingLeave);
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
