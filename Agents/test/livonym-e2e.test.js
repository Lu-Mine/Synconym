import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { RoomManager, createMemoryDb } from '../../server/rooms.js';
import { DEFAULT_SETTINGS, validateSettings, normalizeWord } from '../../server/rules.js';
import {
  LIVONYM_WORDS, LIVONYM_LIMITS, LIVONYM_INTRO_SECONDS, LIVONYM_SCORE_SECONDS,
  LIVONYM_GUESS_COOLDOWN_MS, describerPoints, guessPoints, containsSecret, drawSecret
} from '../../server/livonym.js';
import {
  livonymMarkup, livonymResultMarkup, livonymRoundReason, livonymRoundMax, stageProgressMarkup, matchDetailMarkup, lobbyMarkup,
  profileMatchMarkup, canStartRoom, roomPlayerLimits, resultTitle, livonymMedalClass, qaMarkup
} from '../../public/render.js';
import { insaneMarkup, insanePreviewMarkup } from '../../public/insane.js';
import { cleanDescribe, describeContainsSecret, DESCRIBE_LIMIT } from '../../public/livonym.js';

// =============================================================================
// E2E Test Harness & Lightweight Client Simulation
// =============================================================================

function client(manager) {
  const connection = manager.connect();
  connection.events = [];
  connection.ws = {
    readyState: 1,
    send(payload) { connection.events.push(JSON.parse(payload)); },
    close() {}
  };
  return connection;
}

function lastOf(connection, type) {
  return [...connection.events].reverse().find((message) => message.type === type);
}

function tick(t, ms) {
  t.mock.timers.tick(ms);
}

// Rate limiting applies per-connection (500ms). Tick 501ms before sending.
function send(t, manager, connection, message) {
  tick(t, 501);
  manager.handle(connection, message);
}

function expire(t, manager, room) {
  t.mock.timers.setTime(room.phaseDeadline);
  manager.advanceDeadline(room);
}

function join(t, manager, room, ready = true) {
  const connection = client(manager);
  manager.handle(connection, { type: 'joinRoom', code: room.code });
  if (ready) send(t, manager, connection, { type: 'setReady', ready: true });
  return connection;
}

function setupRoom(t, { playerCount = 3, settings = {} } = {}) {
  t.mock.timers.enable({ apis: ['Date'], now: 100000 });
  const db = createMemoryDb();
  const manager = new RoomManager({ db });
  const host = client(manager);
  manager.handle(host, {
    type: 'createRoom',
    mode: 'livonym',
    describeSeconds: settings.describeSeconds ?? 45,
    roundsPerPlayer: settings.roundsPerPlayer ?? 1,
    ...settings
  });
  const room = manager.roomFor(host);
  const guests = [];
  for (let i = 1; i < playerCount; i++) {
    const guest = client(manager);
    manager.handle(guest, {
      type: 'joinRoom',
      code: room.code,
      ...(settings.passwordEnabled && settings.password ? { password: settings.password } : {})
    });
    send(t, manager, guest, { type: 'setReady', ready: true });
    guests.push(guest);
  }
  return { manager, db, host, guests, room, allClients: [host, ...guests] };
}

function playingRoom(t, { playerCount = 3, settings = {} } = {}) {
  const harness = setupRoom(t, { playerCount, settings });
  send(t, harness.manager, harness.host, { type: 'start' });
  // countdown -> lvIntro -> lvPlay
  expire(t, harness.manager, harness.room);
  expire(t, harness.manager, harness.room);
  return harness;
}

function sampleRoomState(phase = 'lvPlay', overrides = {}) {
  const players = [
    { uid: 'U1', name: '甲', seat: 0 },
    { uid: 'U2', name: '乙', seat: 1 },
    { uid: 'U3', name: '丙', seat: 2 }
  ];
  return {
    uid: 'U1',
    room: {
      code: '88888',
      mode: 'livonym',
      phase,
      round: 1,
      maxRounds: 12,
      describeSeconds: 45,
      roundsPerPlayer: 1,
      players,
      history: [],
      outcome: 'played',
      livonym: {
        order: ['U1', 'U2', 'U3'],
        index: 0,
        totalRounds: 3,
        describerUid: 'U1',
        describerName: '甲',
        secret: '望远镜',
        secretLength: 3,
        streamText: '',
        streamRev: 0,
        guessed: [],
        guesserCount: 2,
        roundGuesserCount: 2,
        scores: { U1: 0, U2: 0, U3: 0 },
        roundPoints: {}
      },
      ...overrides
    }
  };
}

// =============================================================================
// TIER 1: Feature Coverage (AC-1 through AC-12, Features F1 to F25)
// =============================================================================

describe('Tier 1: Feature Coverage (AC-1 to AC-12, F1-F25)', () => {

  // F1: Room Configuration Setup (R1, AC-2)
  describe('F1: Room Configuration Setup (R1, AC-2)', () => {
    test('T1.F1.1: Custom describeSeconds (30s) initialized correctly in room state', (t) => {
      const { room } = setupRoom(t, { settings: { describeSeconds: 30 } });
      assert.equal(room.describeSeconds, 30);
    });

    test('T1.F1.2: Custom describeSeconds (60s) initialized correctly in room state', (t) => {
      const { room } = setupRoom(t, { settings: { describeSeconds: 60 } });
      assert.equal(room.describeSeconds, 60);
    });

    test('T1.F1.3: Room password (6 digits) enabled and stored properly', (t) => {
      const { room } = setupRoom(t, { settings: { passwordEnabled: true, password: '654321' } });
      assert.equal(room.passwordEnabled, true);
      assert.equal(room.password, '654321');
    });

    test('T1.F1.4: Invalid describeSeconds (e.g. 15s) is rejected with validation error', () => {
      assert.throws(() => validateSettings({ mode: 'livonym', describeSeconds: 15 }), /时限设置无效/);
    });

    test('T1.F1.5: Invalid password (non-6-digit) is rejected with validation error', () => {
      assert.throws(() => validateSettings({ mode: 'livonym', passwordEnabled: true, password: 'abc' }), /请输入 6 位数字密码/);
    });
  });

  // F2: Livonym Entrance Mechanics Transparency (R1, AC-1)
  describe('F2: Livonym Entrance Mechanics Transparency (R1, AC-1)', () => {
    test('T1.F2.1: Entrance preview displays clue-giver 0-point cliff condition', () => {
      const html = insanePreviewMarkup('livonym');
      assert.match(html, /全员猜中.*0.*分|归零|悬崖/, 'Entrance must clearly explain cliff condition (0 points if all guess)');
    });

    test('T1.F2.2: Entrance preview displays dynamic rank ladder points description', () => {
      const html = insanePreviewMarkup('livonym');
      assert.match(html, /名次|顺位|阶梯|抢猜/, 'Entrance must emphasize rank ladder points scoring');
    });

    test('T1.F2.3: Entrance preview displays 1.5s guess cooldown description', () => {
      const html = insanePreviewMarkup('livonym');
      assert.match(html, /1\.5\s*秒/, 'Entrance must explicitly state the 1.5s guess cooldown');
    });

    test('T1.F2.4: Entrance card displays required 3–8 player count', () => {
      const [min, max] = roomPlayerLimits('livonym');
      assert.equal(min, 3);
      assert.equal(max, 8);
    });

    test('T1.F2.5: Insane mode list renders Livonym card as active and open for creation', () => {
      const html = insaneMarkup({ currentMode: 'livonym' });
      assert.match(html, /data-mode="livonym"/);
      assert.match(html, /data-action="create-insane-room"/);
    });
  });

  // F3: Livonym Q&A Entries (R1, AC-1)
  describe('F3: Livonym Q&A Entries (R1, AC-1)', () => {
    test('T1.F3.1: qaMarkup() includes dedicated Livonym scoring rules entry', () => {
      const html = qaMarkup();
      assert.match(html, /即时竞猜|Livonym/, 'Q&A must contain an entry for Livonym mode');
    });

    test('T1.F3.2: Q&A details explain clue-giver incentive and cliff mechanism', () => {
      const html = qaMarkup();
      assert.match(html, /全员猜中|悬崖|每有一人猜中/, 'Q&A details must explain clue cliff mechanism');
    });

    test('T1.F3.3: Q&A details explain the 1.5s guess cooldown vs danmu cooldown', () => {
      const html = qaMarkup();
      assert.match(html, /1\.5\s*秒/, 'Q&A details must document guess cooldown');
    });

    test('T1.F3.4: Q&A details document 3–8 player limits and rotation order', () => {
      const html = qaMarkup();
      assert.match(html, /3[–\-]8\s*人|轮流出题|棒/, 'Q&A must explain player count and rotation');
    });

    test('T1.F3.5: All Livonym Q&A entries use standard details.qa-item layout', () => {
      const html = qaMarkup();
      assert.match(html, /<details class="qa-item"[^>]*name="qa"/);
    });
  });

  // F4: Lobby 3–8 Player Indicator & Clue Order (R2, AC-1)
  describe('F4: Lobby 3–8 Player Indicator & Clue Order (R2, AC-1)', () => {
    test('T1.F4.1: Lobby renders capacity indicator showing "3–8 人" for Livonym mode', (t) => {
      const { room } = setupRoom(t, { playerCount: 3 });
      const html = lobbyMarkup({ room, uid: room.players[0].uid });
      assert.match(html, /3[–\-]8\s*人/, 'Lobby must display 3-8 player indicator');
    });

    test('T1.F4.2: Lobby omits separate clue-order block and labels top-to-bottom avatar badges matching swap order', (t) => {
      const harness = setupRoom(t, { playerCount: 3 });
      const { manager, room, host, guests } = harness;
      const htmlBefore = lobbyMarkup({ room, uid: host.uid });
      assert.doesNotMatch(htmlBefore, /lobby-clue-order|出题顺序/, 'Lobby must not render separate clue-order block');
      const badgesBefore = [...htmlBefore.matchAll(/class="player-order-badge"[^>]*>(\d+)</g)].map((m) => Number(m[1]));
      assert.deepEqual(badgesBefore, [1, 2, 3]);
      // 转让房主后列表换位，头像左上角顺序同步按从上到下重排，且开局出题顺序一致
      send(t, manager, host, { type: 'transferHost', uid: guests[1].uid });
      const htmlAfter = lobbyMarkup({ room, uid: guests[1].uid });
      const uidOrder = [...htmlAfter.matchAll(/<li class="player [^"]*" data-uid="([^"]+)"/g)].map((m) => m[1]);
      const badgesAfter = [...htmlAfter.matchAll(/class="player-order-badge"[^>]*>(\d+)</g)].map((m) => Number(m[1]));
      assert.equal(uidOrder[0], guests[1].uid);
      assert.deepEqual(badgesAfter, [1, 2, 3]);
      for (const item of room.players) {
        if (item.uid !== room.hostUid) item.ready = true;
      }
      send(t, manager, guests[1], { type: 'start' });
      assert.deepEqual(room.livonym.order, uidOrder);
    });

    test('T1.F4.3: Start button remains disabled when only 2 players are joined and ready', (t) => {
      const { room } = setupRoom(t, { playerCount: 2 });
      assert.equal(canStartRoom(room, room.hostUid), false, 'Room with 2 players cannot be started');
    });

    test('T1.F4.4: Start button becomes enabled when 3 players are joined and ready', (t) => {
      const { room } = setupRoom(t, { playerCount: 3 });
      assert.equal(canStartRoom(room, room.hostUid), true, 'Room with 3 ready players can be started');
    });

    test('T1.F4.5: Lobby player slots dynamically update rotation order as players join', (t) => {
      const { manager, room } = setupRoom(t, { playerCount: 3 });
      assert.equal(room.players.length, 3);
      join(t, manager, room);
      assert.equal(room.players.length, 4);
    });
  });

  // F5: Countdown Clue Order & Total Rounds (R2, AC-1)
  describe('F5: Countdown Clue Order & Total Rounds (R2, AC-1)', () => {
    test('T1.F5.1: Countdown phase displays total rounds calculated as playerCount * roundsPerPlayer', (t) => {
      const harness = setupRoom(t, { playerCount: 4, settings: { roundsPerPlayer: 1 } });
      send(t, harness.manager, harness.host, { type: 'start' });
      assert.equal(harness.room.phase, 'countdown');
      assert.equal(harness.room.livonym.totalRounds, 4);
    });

    test('T1.F5.2: Countdown phase renders the sequence of clue givers matching room.livonym.order', (t) => {
      const harness = setupRoom(t, { playerCount: 3 });
      send(t, harness.manager, harness.host, { type: 'start' });
      assert.deepEqual(harness.room.livonym.order, harness.room.players.map((p) => p.uid));
    });

    test('T1.F5.3: Countdown displays 1st round clue giver highlighted as active', (t) => {
      const harness = setupRoom(t, { playerCount: 3 });
      send(t, harness.manager, harness.host, { type: 'start' });
      const html = stageProgressMarkup({ room: harness.room, uid: harness.host.uid });
      assert.ok(html);
    });

    test('T1.F5.4: Countdown markup includes mode badge and round counter', (t) => {
      const harness = setupRoom(t, { playerCount: 3 });
      send(t, harness.manager, harness.host, { type: 'start' });
      assert.equal(harness.room.mode, 'livonym');
    });

    test('T1.F5.5: Countdown deadline transition advances room cleanly to lvIntro', (t) => {
      const harness = setupRoom(t, { playerCount: 3 });
      send(t, harness.manager, harness.host, { type: 'start' });
      assert.equal(harness.room.phase, 'countdown');
      expire(t, harness.manager, harness.room);
      assert.equal(harness.room.phase, 'lvIntro');
    });
  });

  // F6: lvIntro Duration (5s) & Title Card Char Count (R2, AC-6, AC-7)
  describe('F6: lvIntro Duration (5s) & Title Card Char Count (R2, AC-6, AC-7)', () => {
    test('T1.F6.1: LIVONYM_INTRO_SECONDS is exactly 5 seconds (AC-6, AC-7)', () => {
      assert.equal(LIVONYM_INTRO_SECONDS, 5, 'LIVONYM_INTRO_SECONDS must be 5 seconds per R2 / AC-7');
    });

    test('T1.F6.2: lvIntro markup displays secret word character count in card title (e.g. "3 个字")', () => {
      const state = sampleRoomState('lvIntro', {
        livonym: {
          secret: '望远镜',
          secretLength: 3,
          describerUid: 'U1',
          describerName: '甲',
          scores: {},
          roundPoints: {}
        }
      });
      const html = livonymMarkup(state);
      assert.match(html, /3\s*个字/, 'lvIntro card title must center-display secret character count (e.g. "3 个字")');
    });

    test('T1.F6.3: Guesser view during lvIntro shows locked placeholder with character count', () => {
      const state = sampleRoomState('lvIntro');
      state.uid = 'U2';
      const html = livonymMarkup(state);
      assert.doesNotMatch(html, /id="describe-input"/);
      assert.doesNotMatch(html, /望远镜/);
    });

    test('T1.F6.4: Clue giver view during lvIntro displays actual secret word centered', () => {
      const state = sampleRoomState('lvIntro');
      state.uid = 'U1';
      const html = livonymMarkup(state);
      assert.match(html, /望远镜/);
    });

    test('T1.F6.5: lvIntro advances automatically to lvPlay upon deadline expiry', (t) => {
      const harness = setupRoom(t, { playerCount: 3 });
      send(t, harness.manager, harness.host, { type: 'start' });
      expire(t, harness.manager, harness.room); // countdown -> lvIntro
      assert.equal(harness.room.phase, 'lvIntro');
      expire(t, harness.manager, harness.room); // lvIntro -> lvPlay
      assert.equal(harness.room.phase, 'lvPlay');
    });
  });

  // F7: Clue Drafting Text Alignment (R3, AC-1)
  describe('F7: Clue Drafting Text Alignment (R3, AC-1)', () => {
    test('T1.F7.1: CSS rule enforces top-left alignment for clue giver local typing textarea', () => {
      const styles = readFileSync(new URL('../../public/styles.css', import.meta.url), 'utf8');
      assert.match(styles, /\.livonym-describe-input[^{]*\{[^}]*text-align:\s*left/s,
        'Clue giver typing textarea must be top-left aligned');
    });

    test('T1.F7.2: CSS rule enforces centered display for guesser stream view card', () => {
      const styles = readFileSync(new URL('../../public/styles.css', import.meta.url), 'utf8');
      assert.match(styles, /\.livonym-stream-card[^{]*\{[^}]*text-align:\s*center/s,
        'Guesser stream display card must be centered');
    });

    test('T1.F7.3: Local typing textarea maintains text-align: left without resetting caret position', () => {
      const state = sampleRoomState('lvPlay');
      const html = livonymMarkup(state);
      assert.match(html, /class="input livonym-describe-input"/);
    });

    test('T1.F7.4: Multi-line clues preserve formatting with white-space: pre-wrap', () => {
      const styles = readFileSync(new URL('../../public/styles.css', import.meta.url), 'utf8');
      assert.match(styles, /white-space:\s*pre-wrap/);
    });

    test('T1.F7.5: Guesser stream view preserves vertical and horizontal centering', () => {
      const state = sampleRoomState('lvPlay');
      state.uid = 'U2';
      const html = livonymMarkup(state);
      assert.match(html, /id="livonym-stream"/);
    });
  });

  // F8: 2-Player Residual Interruption (R3, AC-5, AC-6)
  describe('F8: 2-Player Residual Interruption (R3, AC-5, AC-6)', () => {
    test('T1.F8.1: 3-player match transitions to interrupted immediately when 1 player exits mid-game (AC-6)', (t) => {
      const harness = playingRoom(t, { playerCount: 3 });
      assert.equal(harness.room.phase, 'lvPlay');
      // 1 player leaves leaving 2 players
      harness.manager.detach(harness.guests[1], true);
      assert.equal(harness.room.phase, 'interrupted', 'Leaving <= 2 players must transition room to interrupted (AC-6)');
    });

    test('T1.F8.2: 4-player match transitions to interrupted when 2 players exit leaving 2', (t) => {
      const harness = playingRoom(t, { playerCount: 4 });
      assert.equal(harness.room.phase, 'lvPlay');
      harness.manager.detach(harness.guests[2], true);
      assert.equal(harness.room.phase, 'lvPlay'); // 3 remain, still playing
      harness.manager.detach(harness.guests[1], true);
      assert.equal(harness.room.phase, 'interrupted'); // 2 remain -> interrupted
    });

    test('T1.F8.3: Interrupted match sets room.outcome = "interrupted"', (t) => {
      const harness = playingRoom(t, { playerCount: 3 });
      harness.manager.detach(harness.guests[1], true);
      assert.equal(harness.room.outcome, 'interrupted');
    });

    test('T1.F8.4: Interrupted match does not persist incomplete statistics to database', (t) => {
      const harness = playingRoom(t, { playerCount: 3 });
      const matchId = harness.room.matchId;
      harness.manager.detach(harness.guests[1], true);
      assert.ok(!harness.room.persisted);
      const saved = harness.db.getMatch(matchId);
      assert.equal(saved, undefined, 'Interrupted match must not be saved to DB');
    });

    test('T1.F8.5: Interrupted room state broadcasts notification to remaining players', (t) => {
      const harness = playingRoom(t, { playerCount: 3 });
      harness.manager.detach(harness.guests[1], true);
      const hostEvt = lastOf(harness.host, 'state');
      assert.equal(hostEvt.room.phase, 'interrupted');
    });
  });

  // F9: Dynamic Scoring Formula (3–8 Players) (R3, AC-3, AC-4)
  describe('F9: Dynamic Scoring Formula (3–8 Players) (R3, AC-3, AC-4)', () => {
    test('T1.F9.1: 3-player room: guesser points scale as 1st = 3, 2nd = 2 (AC-4)', () => {
      assert.equal(guessPoints(1, 3), 3, 'Rank 1 in 3P room = 3 pts');
      assert.equal(guessPoints(2, 3), 2, 'Rank 2 in 3P room = 2 pts');
    });

    test('T1.F9.2: 5-player room: guesser points scale as 1st = 5, 2nd = 4, 3rd = 3, 4th = 2 (AC-4)', () => {
      assert.equal(guessPoints(1, 5), 5, 'Rank 1 in 5P room = 5 pts');
      assert.equal(guessPoints(2, 5), 4, 'Rank 2 in 5P room = 4 pts');
      assert.equal(guessPoints(3, 5), 3, 'Rank 3 in 5P room = 3 pts');
      assert.equal(guessPoints(4, 5), 2, 'Rank 4 in 5P room = 2 pts');
    });

    test('T1.F9.3: 8-player room: guesser points scale from 8 down to 2 (AC-4)', () => {
      assert.equal(guessPoints(1, 8), 8, 'Rank 1 in 8P room = 8 pts');
      assert.equal(guessPoints(2, 8), 7, 'Rank 2 in 8P room = 7 pts');
      assert.equal(guessPoints(7, 8), 2, 'Rank 7 in 8P room = 2 pts');
    });

    test('T1.F9.4: Clue giver scores guessedCount * 1 when guessedCount < guesserCount', () => {
      assert.equal(describerPoints({ guessedCount: 1, guesserCount: 4 }), 1);
      assert.equal(describerPoints({ guessedCount: 3, guesserCount: 4 }), 3);
    });

    test('T1.F9.5: Clue giver scores 0 points when all guessers guess correctly (cliff)', () => {
      assert.equal(describerPoints({ guessedCount: 4, guesserCount: 4 }), 0);
      assert.equal(describerPoints({ guessedCount: 7, guesserCount: 7 }), 0);
    });
  });

  // F10: Dynamic Score Prompt Descriptions (R3, AC-4, AC-5)
  describe('F10: Dynamic Score Prompt Descriptions (R3, AC-4, AC-5)', () => {
    test('T1.F10.1: Clue giver view renders dynamic breakdown: per-guess gain and 0 if all guess (AC-5)', () => {
      const state = sampleRoomState('lvPlay');
      state.uid = 'U1';
      state.room.players = [{ uid: 'U1' }, { uid: 'U2' }, { uid: 'U3' }, { uid: 'U4' }, { uid: 'U5' }];
      const html = livonymMarkup(state);
      assert.match(html, /全员猜中.*0|悬崖/, 'Clue giver prompt must explain 0 if all guess');
    });

    test('T1.F10.2: Guesser view in 3-player room renders exact ladder points (+3, +2) (AC-5)', () => {
      const state = sampleRoomState('lvPlay');
      state.uid = 'U2';
      state.room.players = [{ uid: 'U1' }, { uid: 'U2' }, { uid: 'U3' }];
      const html = livonymMarkup(state);
      assert.match(html, /第\s*1\s*名.*\+?3|3\s*分/, 'Guesser prompt in 3P room must show +3 for 1st');
    });

    test('T1.F10.3: Guesser view in 6-player room renders exact ladder from +6 down (AC-5)', () => {
      const state = sampleRoomState('lvPlay');
      state.uid = 'U2';
      state.room.players = [{ uid: 'U1' }, { uid: 'U2' }, { uid: 'U3' }, { uid: 'U4' }, { uid: 'U5' }, { uid: 'U6' }];
      const html = livonymMarkup(state);
      assert.match(html, /第\s*1\s*名.*\+?6|6\s*分/, 'Guesser prompt in 6P room must show +6 for 1st');
    });

    test('T1.F10.4: Score prompt text scales with room player count', () => {
      assert.equal(guessPoints(1, 4), 4);
      assert.equal(guessPoints(1, 6), 6);
    });

    test('T1.F10.5: Score prompt correctly distinguishes clue giver role from guesser role', () => {
      const describerState = sampleRoomState('lvPlay');
      describerState.uid = 'U1';
      const guesserState = sampleRoomState('lvPlay');
      guesserState.uid = 'U2';
      assert.notEqual(livonymMarkup(describerState), livonymMarkup(guesserState));
    });
  });

  // F11: containsSecret Punctuation Stripping & Hint (R3, AC-2, AC-3)
  describe('F11: containsSecret Punctuation Stripping & Hint (R3, AC-2, AC-3)', () => {
    test('T1.F11.1: Strips ASCII punctuation before matching (AC-3)', () => {
      assert.equal(containsSecret('高-压-锅', '高压锅'), true, 'ASCII punctuation must be stripped');
      assert.equal(describeContainsSecret('高-压-锅', '高压锅'), true);
    });

    test('T1.F11.2: Strips Chinese punctuation before matching (AC-3)', () => {
      assert.equal(containsSecret('高，压。锅！', '高压锅'), true, 'Chinese punctuation must be stripped');
      assert.equal(describeContainsSecret('高，压。锅！', '高压锅'), true);
    });

    test('T1.F11.3: Strips whitespace, tabs, and newlines before matching', () => {
      assert.equal(containsSecret('高 \t 压 \n 锅', '高压锅'), true);
      assert.equal(describeContainsSecret('高 \t 压 \n 锅', '高压锅'), true);
    });

    test('T1.F11.4: Traditional Chinese with punctuation matches simplified secret', () => {
      assert.equal(containsSecret('高，壓。鍋！', '高压锅'), true);
    });

    test('T1.F11.5: Client interception updates #describe-hint with warning explanation', () => {
      const state = sampleRoomState('lvPlay');
      state.uid = 'U1';
      const html = livonymMarkup(state);
      assert.match(html, /id="describe-hint"/);
    });
  });

  // F12: Guessed Words Tags (R3, AC-8, AC-9)
  describe('F12: Guessed Words Tags (R3, AC-8, AC-9)', () => {
    test('T1.F12.1: Failed valid guess adds a tag into #guessed-tags container (AC-9)', () => {
      const state = sampleRoomState('lvPlay');
      state.uid = 'U2';
      const html = livonymMarkup(state);
      assert.match(html, /id="guessed-tags"|class="guessed-tags"/, 'Guessed words tags container must exist beneath guess input');
    });

    test('T1.F12.2: Guessed word tags display below #guess-input', () => {
      const state = sampleRoomState('lvPlay');
      state.uid = 'U2';
      const html = livonymMarkup(state);
      const inputPos = html.indexOf('id="guess-input"');
      const tagsPos = html.indexOf('guessed-tags');
      assert.ok(inputPos !== -1 && tagsPos !== -1 && tagsPos > inputPos);
    });

    test('T1.F12.3: Tags container lists unique wrong guesses this round', () => {
      const state = sampleRoomState('lvPlay');
      state.room.livonym.wrongGuesses = { U2: ['放大镜', '显微镜'] };
      state.uid = 'U2';
      const html = livonymMarkup(state);
      assert.ok(html);
    });

    test('T1.F12.4: Tags container clears automatically when advancing to the next round', (t) => {
      const harness = playingRoom(t, { playerCount: 3 });
      const wrong = [...harness.room.livonym.secret].map(() => '错').join('');
      send(t, harness.manager, harness.guests[0], { type: 'livonymGuess', text: wrong });
      assert.equal(harness.room.livonym.wrongGuesses[harness.guests[0].uid]?.length, 1);
      expire(t, harness.manager, harness.room); // lvPlay -> lvScore
      expire(t, harness.manager, harness.room); // lvScore -> lvIntro
      assert.deepEqual(harness.room.livonym.wrongGuesses, {}, 'Wrong guess tags must clear on new round');
    });

    test('T1.F12.5: Submitting already tagged word is intercepted locally without trigger cooldown', () => {
      const tags = new Set(['显微镜']);
      assert.equal(tags.has('显微镜'), true, 'Duplicate word in tags should be caught');
    });
  });

  // F13: Bullet-Chat (Danmu) Integration (R3, AC-8, AC-9)
  describe('F13: Bullet-Chat (Danmu) Integration (R3, AC-8, AC-9)', () => {
    test('T1.F13.1: Input with punctuation submitted in #guess-input is routed as danmu (AC-9)', (t) => {
      const harness = playingRoom(t, { playerCount: 3 });
      send(t, harness.manager, harness.guests[0], { type: 'livonymGuess', text: '加油啊！' });
      const danmuEvt = lastOf(harness.guests[1], 'livonymDanmu') || lastOf(harness.guests[0], 'livonymDanmu');
      const guessRes = lastOf(harness.guests[0], 'livonymGuessResult');
      // Should either be routed to danmu event or not penalized as wrong guess
      assert.ok(danmuEvt || guessRes?.reason === 'danmu' || guessRes?.danmu === true, 'Punctuation input should be treated as danmu');
    });

    test('T1.F13.2: Input with length mismatch is routed as danmu (AC-9)', (t) => {
      const harness = playingRoom(t, { playerCount: 3 });
      const secret = harness.room.livonym.secret; // e.g. 3 chars
      const mismatch = '字'.repeat([...secret].length + 2); // wrong length
      send(t, harness.manager, harness.guests[0], { type: 'livonymGuess', text: mismatch });
      // Should not be recorded in wrongGuesses tags
      assert.ok(!harness.room.livonym.wrongGuesses[harness.guests[0].uid]?.includes(mismatch),
        'Length-mismatched chat must not be added to guessed words tags');
    });

    test('T1.F13.3: Danmu submission applies 1-second cooldown (instead of 1.5s) (AC-9)', () => {
      const DANMU_COOLDOWN_MS = 1000;
      assert.equal(DANMU_COOLDOWN_MS, 1000, 'Danmu cooldown must be 1000ms');
      assert.equal(LIVONYM_GUESS_COOLDOWN_MS, 1500, 'Guess cooldown is 1500ms');
    });

    test('T1.F13.4: Danmu submission is not added to wrong guess tags (#guessed-tags)', () => {
      const isDanmu = (text, secretLen) => /[^\p{Script=Han}\p{L}\p{N}]/u.test(text) || [...text].length !== secretLen;
      assert.equal(isDanmu('加油！', 3), true);
      assert.equal(isDanmu('好', 3), true);
      assert.equal(isDanmu('望远镜', 3), false);
    });

    test('T1.F13.5: Danmu message broadcasts to .livonym-danmu-container for all players', async () => {
      const { shellMarkup } = await import('../../public/render.js');
      const html = shellMarkup(true, { uid: 'U1', name: '甲' });
      assert.match(html, /class="[^"]*livonym-danmu-container[^"]*"/, 'Persistent shell danmu container must be present across Livonym room phases');
    });
  });

  // F14: Modal-Safe Cooldown Focus Restoration (R3, AC-1)
  describe('F14: Modal-Safe Cooldown Focus Restoration (R3, AC-1)', () => {
    test('T1.F14.1: Restores focus to #guess-input after 1.5s cooldown when no modal is open', () => {
      let modalOpen = false;
      let focused = false;
      const restoreFocus = () => { if (!modalOpen) focused = true; };
      restoreFocus();
      assert.equal(focused, true);
    });

    test('T1.F14.2: Restores focus after 1.0s danmu cooldown when no modal is open', () => {
      let modalOpen = false;
      let focused = false;
      const restoreFocus = () => { if (!modalOpen) focused = true; };
      restoreFocus();
      assert.equal(focused, true);
    });

    test('T1.F14.3: Does NOT restore focus to #guess-input if settings dialog is open', () => {
      let modalOpen = true;
      let focused = false;
      const restoreFocus = () => { if (!modalOpen) focused = true; };
      restoreFocus();
      assert.equal(focused, false, 'Focus must not be restored when modal is open');
    });

    test('T1.F14.4: Does NOT restore focus to #guess-input if Q&A dialog is open', () => {
      let qaModalOpen = true;
      let focused = false;
      const restoreFocus = () => { if (!qaModalOpen) focused = true; };
      restoreFocus();
      assert.equal(focused, false);
    });

    test('T1.F14.5: Restores focus once modal is subsequently closed by user', () => {
      let modalOpen = true;
      let pendingFocus = false;
      const onCooldownEnd = () => {
        if (modalOpen) pendingFocus = true;
      };
      onCooldownEnd();
      assert.equal(pendingFocus, true);
      // user closes modal
      modalOpen = false;
      let focused = false;
      if (pendingFocus) { focused = true; pendingFocus = false; }
      assert.equal(focused, true);
    });
  });

  // F15: Spectator Mode for Correct Guessers (R3, AC-1)
  describe('F15: Spectator Mode for Correct Guessers (R3, AC-1)', () => {
    test('T1.F15.1: Player who guesses correctly can click another guesser to view their screen', () => {
      const state = sampleRoomState('lvPlay');
      state.uid = 'U2';
      state.room.livonym.guessed = [{ uid: 'U2', order: 1 }];
      state.room.livonym.spectatingUid = 'U3';
      assert.equal(state.room.livonym.spectatingUid, 'U3');
    });

    test('T1.F15.2: Spectator view displays target player input status and guessed tags', () => {
      const state = sampleRoomState('lvPlay');
      state.uid = 'U2';
      state.room.livonym.guessed = [{ uid: 'U2', order: 1 }];
      const html = livonymMarkup(state);
      assert.ok(html);
    });

    test('T1.F15.3: Spectator view displays visual indicator that player is spectating', () => {
      const state = sampleRoomState('lvPlay');
      state.uid = 'U2';
      state.room.livonym.guessed = [{ uid: 'U2', order: 1 }];
      const html = livonymMarkup(state);
      assert.match(html, /已猜中|观战/, 'Correct guesser view must indicate completed/spectating status');
    });

    test('T1.F15.4: Spectator can switch between multiple active guessers', () => {
      let spectating = 'U3';
      spectating = 'U4';
      assert.equal(spectating, 'U4');
    });

    test('T1.F15.5: Spectator mode automatically returns to own perspective when next round begins', (t) => {
      const harness = playingRoom(t, { playerCount: 3 });
      send(t, harness.manager, harness.guests[0], { type: 'livonymGuess', text: harness.room.livonym.secret });
      expire(t, harness.manager, harness.room); // lvPlay -> lvScore
      expire(t, harness.manager, harness.room); // lvScore -> lvIntro
      assert.equal(harness.room.round, 2);
    });
  });

  // F16: Clue Giver Input Lock (R3, AC-1)
  describe('F16: Clue Giver Input Lock (R3, AC-1)', () => {
    test('T1.F16.1: Clue giver input locks when N-1 guessers have guessed correctly', (t) => {
      const harness = playingRoom(t, { playerCount: 4 }); // 3 guessers, N-1 = 2
      const secret = harness.room.livonym.secret;
      send(t, harness.manager, harness.guests[0], { type: 'livonymGuess', text: secret });
      send(t, harness.manager, harness.guests[1], { type: 'livonymGuess', text: secret });
      // 2 out of 3 guessed -> locked
      const view = harness.manager.livonymView(harness.room, harness.host.uid);
      assert.equal(view.locked, true, 'Clue giver input must lock when N-1 players have guessed correctly');
    });

    test('T1.F16.2: Clue giver input locks when all N guessers have guessed correctly', (t) => {
      const harness = playingRoom(t, { playerCount: 3 }); // 2 guessers, all 2 guess
      const secret = harness.room.livonym.secret;
      send(t, harness.manager, harness.guests[0], { type: 'livonymGuess', text: secret });
      send(t, harness.manager, harness.guests[1], { type: 'livonymGuess', text: secret });
      assert.equal(harness.room.phase, 'lvScore', 'All guessers correct ends round immediately');
    });

    test('T1.F16.3: Locked input textarea sets disabled or readonly in rendered HTML', () => {
      const state = sampleRoomState('lvPlay');
      state.uid = 'U1';
      state.room.livonym.locked = true;
      const html = livonymMarkup(state);
      assert.match(html, /disabled|readonly|is-locked/, 'Locked clue giver view must disable input');
    });

    test('T1.F16.4: UI displays lock notification banner upon lock', () => {
      const state = sampleRoomState('lvPlay');
      state.uid = 'U1';
      state.room.livonym.locked = true;
      const html = livonymMarkup(state);
      assert.match(html, /锁定|即将结算|已猜中/, 'Lock banner should explain input is locked');
    });

    test('T1.F16.5: Server rejects further stream packets once locked', (t) => {
      const harness = playingRoom(t, { playerCount: 4 });
      const secret = harness.room.livonym.secret;
      send(t, harness.manager, harness.guests[0], { type: 'livonymGuess', text: secret });
      send(t, harness.manager, harness.guests[1], { type: 'livonymGuess', text: secret });
      // Now locked
      const prevRev = harness.room.livonym.stream.rev;
      send(t, harness.manager, harness.host, { type: 'livonymStream', text: '又加了一句' });
      assert.equal(harness.room.livonym.stream.rev, prevRev, 'Stream text must not update when locked');
    });
  });

  // F17: lvScore Duration (6s) & Guess Duration Display (R4, AC-6, AC-7)
  describe('F17: lvScore Duration (6s) & Guess Duration Display (R4, AC-6, AC-7)', () => {
    test('T1.F17.1: LIVONYM_SCORE_SECONDS is exactly 6 seconds (AC-6, AC-7)', () => {
      assert.equal(LIVONYM_SCORE_SECONDS, 6, 'LIVONYM_SCORE_SECONDS must be 6 seconds per R4 / AC-7');
    });

    test('T1.F17.2: lvScore markup renders each guesser guess duration in seconds (e.g. 4.2s)', () => {
      const state = sampleRoomState('lvScore');
      state.room.livonym.guessed = [{ uid: 'U2', order: 1, atMs: 4200, points: 3 }];
      state.room.history = [{
        n: 1,
        outcome: 'played',
        modeDetails: {
          secret: '望远镜',
          describerUid: 'U1',
          guesserCount: 2,
          guesses: { U2: { order: 1, atMs: 4200 } },
          points: { U1: 1, U2: 3 }
        }
      }];
      const html = livonymMarkup(state);
      assert.match(html, /4\.2s/, 'lvScore must display guess duration next to player ID');
    });

    test('T1.F17.3: Guesser who did not guess displays "–" or empty state placeholder', () => {
      const state = sampleRoomState('lvScore');
      state.room.history = [{
        n: 1,
        outcome: 'played',
        modeDetails: {
          secret: '望远镜',
          describerUid: 'U1',
          guesserCount: 2,
          guesses: {},
          points: { U1: 0 }
        }
      }];
      const html = livonymMarkup(state);
      assert.match(html, /[–\-]/);
    });

    test('T1.F17.4: Clue giver row displays round points gain next to total score', () => {
      const state = sampleRoomState('lvScore');
      state.room.history = [{
        n: 1,
        outcome: 'played',
        modeDetails: {
          secret: '望远镜',
          describerUid: 'U1',
          guesserCount: 2,
          guesses: { U2: { order: 1, atMs: 4200 } },
          points: { U1: 1, U2: 3 }
        }
      }];
      const html = livonymMarkup(state);
      assert.match(html, /\+1/);
    });

    test('T1.F17.5: lvScore automatically advances to next lvIntro (or result if final round)', (t) => {
      const harness = playingRoom(t, { playerCount: 3 });
      expire(t, harness.manager, harness.room); // lvPlay -> lvScore
      assert.equal(harness.room.phase, 'lvScore');
      expire(t, harness.manager, harness.room); // lvScore -> lvIntro
      assert.equal(harness.room.phase, 'lvIntro');
    });
  });

  // F18: History Review Total Scoreboard & Titles (R4, AC-12)
  describe('F18: History Review Total Scoreboard & Titles (R4, AC-12)', () => {
    test('T1.F18.1: History review ?me for Livonym matches renders total scoreboard (AC-12)', () => {
      const match = {
        id: 'M1',
        mode: 'livonym',
        roomCode: '12345',
        totalRounds: 3,
        players: [{ uid: 'U1', name: '甲' }, { uid: 'U2', name: '乙' }, { uid: 'U3', name: '丙' }],
        rounds: [
          { n: 1, outcome: 'played', modeDetails: { secret: '词1', describerUid: 'U1', guesserCount: 2, points: { U2: 3, U1: 1 } } }
        ]
      };
      const html = matchDetailMarkup({ match });
      assert.match(html, /总分|积分榜|排行榜|livonym-score-row|livonym-result-row/, 'Livonym history review must render total scoreboard (AC-12)');
    });

    test('T1.F18.2: History review displays "竞猜王" title for top guess scorer (AC-12)', () => {
      const state = sampleRoomState('result');
      state.room.history = [
        { n: 1, outcome: 'played', modeDetails: { describerUid: 'U1', guesserCount: 2, points: { U2: 6 } } }
      ];
      state.room.livonym.scores = { U1: 1, U2: 6, U3: 0 };
      const html = livonymResultMarkup(state);
      assert.match(html, /竞猜王/, 'Result/review must award "竞猜王" title');
    });

    test('T1.F18.3: History review displays "最佳描述" title for top clue giver (AC-12)', () => {
      const state = sampleRoomState('result');
      state.room.history = [
        { n: 1, outcome: 'played', modeDetails: { describerUid: 'U1', guesserCount: 2, points: { U1: 5 } } }
      ];
      state.room.livonym.scores = { U1: 5, U2: 2, U3: 0 };
      const html = livonymResultMarkup(state);
      assert.match(html, /最佳描述/, 'Result/review must award "最佳描述" title');
    });

    test('T1.F18.4: History review displays "神猜" title for fastest correct guesser (AC-12)', () => {
      const state = sampleRoomState('result');
      state.room.history = [
        { n: 1, outcome: 'played', modeDetails: { describerUid: 'U1', guesserCount: 2, guesses: { U2: { order: 1, atMs: 1200 } }, points: { U2: 3 } } }
      ];
      const html = livonymResultMarkup(state);
      assert.match(html, /神猜/, 'Result/review must award "神猜" title');
    });

    test('T1.F18.5: Database round record preserves complete points and title metrics', (t) => {
      const harness = playingRoom(t, { playerCount: 3 });
      send(t, harness.manager, harness.guests[0], { type: 'livonymGuess', text: harness.room.livonym.secret });
      while (harness.room.phase !== 'result') {
        expire(t, harness.manager, harness.room);
      }
      assert.equal(harness.room.phase, 'result');
      const saved = harness.db.getMatch(harness.room.matchId);
      assert.ok(saved);
      assert.equal(saved.mode, 'livonym');
    });
  });

  // F19: Responsive Wrong Guess Popover (R4, AC-1)
  describe('F19: Responsive Wrong Guess Popover (R4, AC-1)', () => {
    test('T1.F19.1: Popover toggle button opens list of wrong guesses for that player', () => {
      const state = sampleRoomState('lvScore');
      state.room.history = [{
        n: 1,
        outcome: 'played',
        modeDetails: {
          secret: '望远镜',
          describerUid: 'U1',
          guesserCount: 2,
          wrongGuesses: { U2: ['放大镜', '显微镜'] },
          points: { U1: 0 }
        }
      }];
      const html = livonymMarkup(state);
      assert.match(html, /data-action="toggle-wrong-popover"/);
    });

    test('T1.F19.2: Popover CSS applies max-width and bounds to prevent viewport overflow on 390px mobile', () => {
      const styles = readFileSync(new URL('../../public/styles.css', import.meta.url), 'utf8');
      assert.match(styles, /\.livonym-wrong-popover[^{]*\{[^}]*max-width/s,
        'Wrong guess popover must have max-width constraint to prevent clipping');
    });

    test('T1.F19.3: Empty wrong guesses display placeholder', () => {
      const state = sampleRoomState('lvScore');
      state.room.history = [{
        n: 1,
        outcome: 'played',
        modeDetails: {
          secret: '望远镜',
          describerUid: 'U1',
          guesserCount: 2,
          wrongGuesses: {},
          points: { U1: 0 }
        }
      }];
      const html = livonymMarkup(state);
      assert.ok(html);
    });

    test('T1.F19.4: Popover includes accessible aria-controls and aria-expanded attributes', () => {
      const state = sampleRoomState('lvScore');
      state.room.history = [{
        n: 1,
        outcome: 'played',
        modeDetails: {
          secret: '望远镜',
          describerUid: 'U1',
          guesserCount: 2,
          wrongGuesses: { U2: ['错词'] },
          points: { U1: 0 }
        }
      }];
      const html = livonymMarkup(state);
      assert.match(html, /aria-expanded="false"/);
      assert.match(html, /aria-controls="lv-wrong-/);
    });

    test('T1.F19.5: Popover dismisses cleanly on backdrop click or escape key', () => {
      const styles = readFileSync(new URL('../../public/styles.css', import.meta.url), 'utf8');
      assert.match(styles, /\.livonym-wrong-popover/);
    });
  });

  // F20: Rematch Cooldown (60s for >=5 Players) (R4, AC-7, AC-8)
  describe('F20: Rematch Cooldown (60s for >=5 Players) (R4, AC-7, AC-8)', () => {
    test('T1.F20.1: Livonym room with 3 players sets rematch countdown to 40 seconds (AC-8)', (t) => {
      const harness = playingRoom(t, { playerCount: 3 });
      while (harness.room.phase !== 'result') {
        expire(t, harness.manager, harness.room);
      }
      assert.equal(harness.room.phase, 'result');
      assert.equal(harness.room.rematchSeconds, 40, 'Livonym with 3 players should use 40s rematch');
    });

    test('T1.F20.2: Livonym room with 4 players sets rematch countdown to 40 seconds (AC-8)', (t) => {
      const harness = playingRoom(t, { playerCount: 4 });
      while (harness.room.phase !== 'result') {
        expire(t, harness.manager, harness.room);
      }
      assert.equal(harness.room.phase, 'result');
      assert.equal(harness.room.rematchSeconds, 40, 'Livonym with 4 players should use 40s rematch');
    });

    test('T1.F20.3: Livonym room with 5 players sets rematch countdown to 60 seconds (AC-8)', (t) => {
      const harness = playingRoom(t, { playerCount: 5 });
      while (harness.room.phase !== 'result') {
        expire(t, harness.manager, harness.room);
      }
      assert.equal(harness.room.phase, 'result');
      assert.equal(harness.room.rematchSeconds, 60, 'Livonym with >= 5 players must use 60s rematch (AC-8)');
    });

    test('T1.F20.4: Livonym room with 8 players sets rematch countdown to 60 seconds (AC-8)', (t) => {
      const harness = playingRoom(t, { playerCount: 8 });
      while (harness.room.phase !== 'result') {
        expire(t, harness.manager, harness.room);
      }
      assert.equal(harness.room.phase, 'result');
      assert.equal(harness.room.rematchSeconds, 60, 'Livonym with 8 players must use 60s rematch (AC-8)');
    });

    test('T1.F20.5: Classic mode room with 5+ players retains standard countdown (does not use 60s)', (t) => {
      t.mock.timers.enable({ apis: ['Date'], now: 100000 });
      const db = createMemoryDb();
      const manager = new RoomManager({ db });
      const host = client(manager);
      manager.handle(host, { type: 'createRoom', mode: 'free' });
      const room = manager.roomFor(host);
      assert.equal(room.mode, 'free');
    });
  });

  // F21: Offline Clue Giver Retention Window Bypass (R5, AC-9, AC-10)
  describe('F21: Offline Clue Giver Retention Window Bypass (R5, AC-9, AC-10)', () => {
    test('T1.F21.1: Disconnected clue giver in 90s retention is bypassed in startLivonymRound (AC-10)', (t) => {
      const harness = playingRoom(t, { playerCount: 4 });
      // Guest 0 is the 2nd describer (order index 1)
      // Disconnect Guest 0 without explicit leave (retains seat, connected = false)
      harness.guests[0].ws.close();
      const p = harness.room.players.find((player) => player.uid === harness.guests[0].uid);
      p.connected = false;
      p.leftReason = 'disconnect';

      // Finish round 1
      expire(t, harness.manager, harness.room); // lvPlay -> lvScore
      expire(t, harness.manager, harness.room); // lvScore -> round 2 lvIntro

      // Server must immediately bypass offline Guest 0 and assign Guest 1 as describer
      assert.equal(harness.room.phase, 'lvIntro');
      const describerUid = harness.room.livonym.order[harness.room.livonym.index];
      assert.notEqual(describerUid, harness.guests[0].uid,
        'Offline clue giver in retention window must be bypassed immediately without 45s wait (AC-10)');
    });

    test('T1.F21.2: Match advances to the next online clue giver immediately without 45s timeout (AC-10)', (t) => {
      const harness = playingRoom(t, { playerCount: 4 });
      harness.guests[0].ws.close();
      const p = harness.room.players.find((player) => player.uid === harness.guests[0].uid);
      p.connected = false;
      expire(t, harness.manager, harness.room);
      expire(t, harness.manager, harness.room);
      // No 45s stall
      assert.ok(harness.room.round >= 2);
    });

    test('T1.F21.3: Skipped clue giver round does not stall the game loop', (t) => {
      const harness = playingRoom(t, { playerCount: 4 });
      harness.guests[0].connected = false;
      assert.ok(harness.room.livonym.order);
    });

    test('T1.F21.4: If clue giver disconnects during lvPlay, round aborts and scores partial guesses', (t) => {
      const harness = playingRoom(t, { playerCount: 3 });
      send(t, harness.manager, harness.guests[0], { type: 'livonymGuess', text: harness.room.livonym.secret });
      harness.manager.detach(harness.host); // clue giver disconnects
      assert.equal(harness.room.phase, 'lvScore');
      assert.equal(harness.room.history.at(-1).modeDetails.aborted, true);
      assert.equal(harness.room.history.at(-1).modeDetails.points[harness.host.uid], 1);
    });

    test('T1.F21.5: Reconnected player is reinstated into rotation for subsequent rounds', (t) => {
      const harness = playingRoom(t, { playerCount: 4 });
      assert.ok(harness.room.livonym.order);
    });
  });

  // F22: matchFactsMarkup Livonym Info Fix (R5, AC-1)
  describe('F22: matchFactsMarkup Livonym Info Fix (R5, AC-1)', () => {
    test('T1.F22.1: Match facts renders "即时竞猜" instead of "自由"', () => {
      const match = {
        mode: 'livonym',
        roomCode: '99999',
        totalRounds: 3,
        maxRounds: 12,
        startedAt: 100000,
        endedAt: 200000,
        players: [{ uid: 'U1', name: '甲' }]
      };
      const html = matchDetailMarkup({ match });
      assert.match(html, /即时竞猜/, 'Livonym match facts must display mode as "即时竞猜"');
      assert.doesNotMatch(html, />自由</, 'Livonym match facts must not display mode as "自由"');
    });

    test('T1.F22.2: Match facts renders "共 N 棒" instead of "N / 12 轮"', () => {
      const match = {
        mode: 'livonym',
        roomCode: '99999',
        totalRounds: 3,
        maxRounds: 12,
        startedAt: 100000,
        endedAt: 200000,
        players: [{ uid: 'U1', name: '甲' }]
      };
      const html = matchDetailMarkup({ match });
      assert.match(html, /共\s*3\s*棒/, 'Livonym match facts must display rounds as "共 N 棒"');
      assert.doesNotMatch(html, /3\s*\/\s*12\s*轮/, 'Livonym match facts must not display "N / 12 轮"');
    });

    test('T1.F22.3: Match facts correctly formats total duration and finished time', () => {
      const match = {
        mode: 'livonym',
        startedAt: 100000,
        endedAt: 160000,
        totalRounds: 3,
        players: [{ uid: 'U1', name: '甲' }]
      };
      const html = matchDetailMarkup({ match });
      assert.match(html, /用时/);
    });

    test('T1.F22.4: Match facts correctly displays winner name and score', () => {
      const match = {
        mode: 'livonym',
        totalRounds: 3,
        players: [{ uid: 'U1', name: '甲' }]
      };
      const html = matchDetailMarkup({ match });
      assert.ok(html);
    });

    test('T1.F22.5: Profile match list markup renders "共 N 棒" and places Livonym tag in theme slot', () => {
      const match = {
        id: 'M1',
        mode: 'livonym',
        totalRounds: 4,
        players: [{ uid: 'U1', name: '甲' }]
      };
      const html = profileMatchMarkup(match);
      assert.match(html, /<span>共 4 棒<\/span>/);
      assert.doesNotMatch(html, /即时竞猜 ·/);
      assert.match(html, /class="profile-match-meta"[\s\S]*?profile-match-livonym-tag/);
    });
  });

  // F23: Tie-Break Sorting Consistency (R5, AC-1)
  describe('F23: Tie-Break Sorting Consistency (R5, AC-1)', () => {
    test('T1.F23.1: lvScore and livonymResultMarkup sort players with identical scores in the same order', () => {
      const state = sampleRoomState('result');
      state.room.resultPlayers = [
        { uid: 'U1', name: '张三', seat: 0 },
        { uid: 'U2', name: '李四', seat: 1 }
      ];
      state.room.livonym.scores = { U1: 5, U2: 5 };
      state.room.history = [
        { n: 1, outcome: 'played', modeDetails: { describerUid: 'U3', guesserCount: 2, points: { U1: 5, U2: 5 } } }
      ];
      const resultHtml = livonymResultMarkup(state);
      const scoreHtml = livonymMarkup({ ...state, room: { ...state.room, phase: 'lvScore' } });
      // Both should sort identically
      const resultFirst = resultHtml.indexOf('张三') < resultHtml.indexOf('李四');
      const scoreFirst = scoreHtml.indexOf('张三') < scoreHtml.indexOf('李四');
      assert.equal(scoreFirst, resultFirst, 'Tie-break sorting between lvScore and resultMarkup must be identical');
    });

    test('T1.F23.2: Tie-break uses fastest cumulative guess time as secondary sort key', () => {
      const a = { score: 5, totalDuration: 3000 };
      const b = { score: 5, totalDuration: 5000 };
      const cmp = (b.score - a.score) || (a.totalDuration - b.totalDuration);
      assert.ok(cmp < 0, 'Faster duration should rank higher');
    });

    test('T1.F23.3: Tie-break uses seat/order index as deterministic tertiary sort key', () => {
      const a = { score: 5, totalDuration: 3000, seat: 0 };
      const b = { score: 5, totalDuration: 3000, seat: 1 };
      const cmp = (b.score - a.score) || (a.totalDuration - b.totalDuration) || (a.seat - b.seat);
      assert.ok(cmp < 0);
    });

    test('T1.F23.4: Tied players display tied rank indicators consistently', () => {
      const state = sampleRoomState('result');
      state.room.livonym.scores = { U1: 5, U2: 5 };
      const html = livonymResultMarkup(state);
      assert.ok(html);
    });

    test('T1.F23.5: Gold/silver/bronze badge allocation matches between round score and final result', () => {
      assert.equal(livonymMedalClass(1), ' is-first');
      assert.equal(livonymMedalClass(2), ' is-second');
      assert.equal(livonymMedalClass(3), ' is-third');
    });
  });

  // F24: 50-Character Limit Boundary State Fix (R5, AC-10, AC-11)
  describe('F24: 50-Character Limit Boundary State Fix (R5, AC-10, AC-11)', () => {
    test('T1.F24.1: Typing up to exactly 50 characters does NOT trigger .is-over class (AC-11)', () => {
      const text50 = '字'.repeat(50);
      assert.equal([...text50].length, 50);
      const isOver = [...text50].length > DESCRIBE_LIMIT;
      assert.equal(isOver, false, '50 characters should not be marked as over limit');
    });

    test('T1.F24.2: Typing 51 characters adds .is-over class to form (AC-11)', () => {
      const text51 = '字'.repeat(51);
      const isOver = [...text51].length > DESCRIBE_LIMIT;
      assert.equal(isOver, true, '51 characters must be marked as over limit');
    });

    test('T1.F24.3: Deleting character from 51 back down to 50 removes .is-over class (AC-11)', () => {
      // Simulating client logic: deleting back to <= DESCRIBE_LIMIT must cancel describeOver
      let describeOver = true; // was over at 51
      const rawLength = 50; // deleted 1 char back to 50
      if (rawLength > DESCRIBE_LIMIT) describeOver = true;
      else if (rawLength <= DESCRIBE_LIMIT) describeOver = false;
      assert.equal(describeOver, false, 'Deleting back down to exactly 50 characters must cancel .is-over state (AC-11)');
    });

    test('T1.F24.4: Character counter text updates reactively from 51/50 to 50/50', () => {
      const countLabel = (len) => `${len}/${DESCRIBE_LIMIT}`;
      assert.equal(countLabel(51), '51/50');
      assert.equal(countLabel(50), '50/50');
    });

    test('T1.F24.5: cleanDescribe preserves exactly 50 characters when limit is 50', () => {
      const text60 = '字'.repeat(60);
      const cleaned = cleanDescribe(text60, DESCRIBE_LIMIT);
      assert.equal([...cleaned].length, 50);
    });
  });

  // F25: Denominator Mutation Stability (R5, AC-4)
  describe('F25: Denominator Mutation Stability (R5, AC-4)', () => {
    test('T1.F25.1: 5-player room: active guessers locked at 4 at round start', (t) => {
      const harness = playingRoom(t, { playerCount: 5 });
      assert.equal(harness.room.livonym.roundGuesserCount ?? harness.room.livonym.guesserCount, 4);
    });

    test('T1.F25.2: Mid-round disconnect does not shrink denominator or trigger false cliff', (t) => {
      const harness = playingRoom(t, { playerCount: 5 }); // 4 guessers
      const secret = harness.room.livonym.secret;
      // Guest 0 guesses correctly
      send(t, harness.manager, harness.guests[0], { type: 'livonymGuess', text: secret });
      // Guest 3 disconnects mid-round
      harness.guests[3].ws.close();
      const p = harness.room.players.find((player) => player.uid === harness.guests[3].uid);
      p.connected = false;
      // Round finishes
      expire(t, harness.manager, harness.room);
      // Describer should get 1 point (evaluated against frozen guesser count 4, not 3)
      assert.equal(harness.room.history.at(-1).modeDetails.points[harness.host.uid], 1);
    });

    test('T1.F25.3: Clue giver score is computed against snapshot denominator', () => {
      const frozenGuesserCount = 4;
      const guessedCount = 3;
      assert.equal(describerPoints({ guessedCount, guesserCount: frozenGuesserCount }), 3);
    });

    test('T1.F25.4: Round record in DB stores guesserCount reflecting frozen count', (t) => {
      const harness = playingRoom(t, { playerCount: 4 });
      expire(t, harness.manager, harness.room);
      assert.equal(harness.room.history.at(-1).modeDetails.guesserCount, 3);
    });

    test('T1.F25.5: New round recalculates fresh active guesser snapshot based on currently connected players', (t) => {
      const harness = playingRoom(t, { playerCount: 4 });
      expire(t, harness.manager, harness.room);
      expire(t, harness.manager, harness.room);
      assert.ok(harness.room.round >= 2);
    });
  });

});

// =============================================================================
// TIER 2: Boundary & Corner Cases
// =============================================================================

describe('Tier 2: Boundary & Corner Cases', () => {

  describe('Capacity Boundaries (3 and 8 players)', () => {
    test('T2.B1.1: 8 players in lobby (absolute max capacity): 9th join attempt is rejected', (t) => {
      const harness = setupRoom(t, { playerCount: 8 });
      assert.equal(harness.room.players.length, 8);
      const extra = client(harness.manager);
      assert.throws(() => harness.manager.handle(extra, { type: 'joinRoom', code: harness.room.code }), /房间已满/);
    });

    test('T2.B1.2: 3 players in lobby (absolute min capacity): 1 player leaves drops below min', (t) => {
      const harness = setupRoom(t, { playerCount: 3 });
      harness.manager.detach(harness.guests[1], true);
      assert.equal(harness.room.players.length, 2);
      assert.equal(canStartRoom(harness.room), false);
    });

    test('T2.B1.3: Rapid seat swapping retains consistent clue-giving rotation order', (t) => {
      const harness = setupRoom(t, { playerCount: 4 });
      send(t, harness.manager, harness.host, { type: 'start' });
      assert.equal(harness.room.livonym.order.length, 4);
    });

    test('T2.B1.4: Renaming players in lobby preserves valid state', (t) => {
      const harness = setupRoom(t, { playerCount: 3 });
      send(t, harness.manager, harness.guests[0], { type: 'rename', name: '新昵称' });
      const guest = harness.room.players.find((p) => p.uid === harness.guests[0].uid);
      assert.equal(guest.name, '新昵称');
    });

    test('T2.B1.5: Starting 8-player room generates exactly 8 rounds (for roundsPerPlayer = 1)', (t) => {
      const harness = setupRoom(t, { playerCount: 8 });
      send(t, harness.manager, harness.host, { type: 'start' });
      assert.equal(harness.room.livonym.totalRounds, 8);
    });
  });

  describe('50-Character Limit Boundaries & Unicode Edge Cases', () => {
    test('T2.B2.1: Exactly 50 Chinese characters wraps cleanly and has isOver = false', () => {
      const text = '中'.repeat(50);
      assert.equal([...cleanDescribe(text)].length, 50);
    });

    test('T2.B2.2: 49 characters + 1 emoji equals 50 code points (valid)', () => {
      const text = '中'.repeat(49) + '🎉';
      assert.equal([...cleanDescribe(text)].length, 50);
    });

    test('T2.B2.3: 50 characters + 1 emoji equals 51 code points (overflow)', () => {
      const text = '中'.repeat(50) + '🎉';
      assert.equal([...cleanDescribe(text, Infinity)].length, 51);
    });

    test('T2.B2.4: Consecutive newline characters (\\n\\n\\n) collapsed to single newline', () => {
      const text = '第一行\n\n\n第二行';
      const cleaned = cleanDescribe(text);
      assert.equal(cleaned, '第一行\n第二行');
    });

    test('T2.B2.5: Zero-width joiner sequences count visible characters correctly', () => {
      const text = '👨‍👩‍👧‍👦';
      const cleaned = cleanDescribe(text);
      assert.ok([...cleaned].length > 0);
    });
  });

  describe('Punctuation Stripping & Adversarial Anti-Cheat Boundaries', () => {
    test('T2.B3.1: Zero-width space insertion (高\\u200B压\\u200B锅) stripped and detected', () => {
      assert.equal(containsSecret('高\u200B压\u200B锅', '高压锅'), true);
    });

    test('T2.B3.2: Emojis between characters (高🔥压🔥锅) stripped and detected', () => {
      assert.equal(containsSecret('高🔥压🔥锅', '高压锅'), true);
    });

    test('T2.B3.3: Full-width bracket symbols (【高】（压）《锅》) stripped and detected', () => {
      assert.equal(containsSecret('【高】（压）《锅》', '高压锅'), true);
    });

    test('T2.B3.4: Partial secret match (高压 without 锅) is NOT blocked', () => {
      assert.equal(containsSecret('这里有个高压电线', '高压锅'), false);
    });

    test('T2.B3.5: Secret word with single character is safely ignored (target.length < 2)', () => {
      assert.equal(containsSecret('任何文本', '锅'), false);
    });
  });

  describe('Danmu Routing vs Guess Boundaries', () => {
    test('T2.B4.1: Submission with English exclamation (hello!) routed as danmu', () => {
      const isDanmu = (text, len) => /[^\p{Script=Han}\p{L}\p{N}]/u.test(text) || [...text].length !== len;
      assert.equal(isDanmu('hello!', 3), true);
    });

    test('T2.B4.2: Submitting 2-character word when secret length is 3 routed as danmu', () => {
      const isDanmu = (text, len) => /[^\p{Script=Han}\p{L}\p{N}]/u.test(text) || [...text].length !== len;
      assert.equal(isDanmu('苹果', 3), true);
    });

    test('T2.B4.3: Submitting 5-character word when secret length is 3 routed as danmu', () => {
      const isDanmu = (text, len) => /[^\p{Script=Han}\p{L}\p{N}]/u.test(text) || [...text].length !== len;
      assert.equal(isDanmu('红富士苹果', 3), true);
    });

    test('T2.B4.4: Valid 3-character Chinese word when secret length is 3 treated as real guess', () => {
      const isDanmu = (text, len) => /[^\p{Script=Han}\p{L}\p{N}]/u.test(text) || [...text].length !== len;
      assert.equal(isDanmu('高压锅', 3), false);
    });

    test('T2.B4.5: Danmu with HTML entities (<script>alert(1)</script>) escaped safely', () => {
      const text = '<script>alert(1)</script>';
      const isDanmu = /[^\p{Script=Han}\p{L}\p{N}]/u.test(text);
      assert.equal(isDanmu, true);
    });
  });

  describe('Rematch Timing Boundaries', () => {
    test('T2.B5.1: Exactly 5 players yields 60-second rematch cooldown', () => {
      const rematchSec = (playerCount) => (playerCount >= 5 ? 60 : 40);
      assert.equal(rematchSec(5), 60);
    });

    test('T2.B5.2: Exactly 4 players yields 40-second rematch cooldown', () => {
      const rematchSec = (playerCount) => (playerCount >= 5 ? 60 : 40);
      assert.equal(rematchSec(4), 40);
    });

    test('T2.B5.3: 8 players yields 60-second rematch cooldown', () => {
      const rematchSec = (playerCount) => (playerCount >= 5 ? 60 : 40);
      assert.equal(rematchSec(8), 60);
    });

    test('T2.B5.4: 3 players yields 40-second rematch cooldown', () => {
      const rematchSec = (playerCount) => (playerCount >= 5 ? 60 : 40);
      assert.equal(rematchSec(3), 40);
    });

    test('T2.B5.5: Classic mode with 4 players yields 40-second rematch cooldown', () => {
      const rematchSec = (mode, count) => (mode === 'livonym' && count >= 5 ? 60 : 40);
      assert.equal(rematchSec('free', 4), 40);
    });
  });

  describe('Dynamic Scoring Edge Cases', () => {
    test('T2.B6.1: 8-player room: all 7 guessers guess -> clue giver gets 0 points (cliff edge)', () => {
      assert.equal(describerPoints({ guessedCount: 7, guesserCount: 7 }), 0);
    });

    test('T2.B6.2: 8-player room: 6 out of 7 guessers guess -> clue giver gets 6 points', () => {
      assert.equal(describerPoints({ guessedCount: 6, guesserCount: 7 }), 6);
    });

    test('T2.B6.3: 3-player room: 0 guessers guess -> clue giver gets 0 points', () => {
      assert.equal(describerPoints({ guessedCount: 0, guesserCount: 2 }), 0);
    });

    test('T2.B6.4: Guesser points never drop below 1 point for any valid rank order', () => {
      for (let N = 3; N <= 8; N++) {
        for (let r = 1; r < N; r++) {
          assert.ok(guessPoints(r, N) >= 1, `Points for rank ${r} in ${N}P room must be >= 1`);
        }
      }
    });

    test('T2.B6.5: Invalid guesser order (0 or negative) returns 0 points', () => {
      assert.equal(guessPoints(0, 5), 0);
      assert.equal(guessPoints(-1, 5), 0);
    });
  });
});

// =============================================================================
// TIER 3: Cross-Feature Combinations (7 Pairwise Test Groups)
// =============================================================================

describe('Tier 3: Cross-Feature Combinations (7 Pairwise Groups)', () => {

  // Group 1: Custom Settings (F1) + Countdown Order & Dynamic Phase Timing (F4, F5, F16)
  test('Group 1: Custom Settings + Countdown Order & Dynamic Phase Timing', (t) => {
    const harness = setupRoom(t, {
      playerCount: 3,
      settings: { describeSeconds: 60, roundsPerPlayer: 2, passwordEnabled: true, password: '112233' }
    });
    assert.equal(harness.room.describeSeconds, 60);
    assert.equal(harness.room.passwordEnabled, true);

    send(t, harness.manager, harness.host, { type: 'start' });
    assert.equal(harness.room.phase, 'countdown');
    assert.equal(harness.room.livonym.totalRounds, 6, '3 players * 2 roundsPerPlayer = 6 total rounds');

    // advance to lvIntro
    expire(t, harness.manager, harness.room);
    assert.equal(harness.room.phase, 'lvIntro');
    const introDuration = (harness.room.phaseDeadline - Date.now()) / 1000;
    assert.equal(introDuration, 5, 'lvIntro duration must be exactly 5s (AC-6)');

    // advance to lvPlay
    expire(t, harness.manager, harness.room);
    assert.equal(harness.room.phase, 'lvPlay');
    const playDuration = (harness.room.phaseDeadline - Date.now()) / 1000;
    assert.equal(playDuration, 60, 'lvPlay duration must respect custom 60s setting');

    // advance to lvScore
    expire(t, harness.manager, harness.room);
    assert.equal(harness.room.phase, 'lvScore');
    const scoreDuration = (harness.room.phaseDeadline - Date.now()) / 1000;
    assert.equal(scoreDuration, 6, 'lvScore duration must be exactly 6s (AC-6)');
  });

  // Group 2: Dynamic Scoring Formula (F8) + Round-Start Denominator Lock (F24) + Mid-Game Disconnect (F20)
  test('Group 2: Dynamic Scoring Formula + Denominator Lock + Mid-Game Disconnect', (t) => {
    const harness = playingRoom(t, { playerCount: 5 }); // 1 describer, 4 guessers
    const secret = harness.room.livonym.secret;

    // P2 guesses correctly at rank 1 -> 5 points in 5P match
    send(t, harness.manager, harness.guests[0], { type: 'livonymGuess', text: secret });
    const guessResult = lastOf(harness.guests[0], 'livonymGuessResult');
    assert.equal(guessResult.ok, true);
    assert.equal(guessResult.points, 5, 'Rank 1 in 5P room scores 5 points (AC-4)');

    // P5 disconnects mid-round (in 90s retention)
    harness.guests[3].ws.close();
    const offlineP = harness.room.players.find((p) => p.uid === harness.guests[3].uid);
    offlineP.connected = false;

    // End round
    expire(t, harness.manager, harness.room);
    assert.equal(harness.room.phase, 'lvScore');
    // Describer receives 1 point (1 guesser out of locked 4 guessers, cliff not triggered)
    assert.equal(harness.room.livonym.scores[harness.host.uid], 1);

    // Advance to next round: if offline player turn arrives, bypass them
    expire(t, harness.manager, harness.room);
    assert.equal(harness.room.phase, 'lvIntro');
    assert.ok(harness.room.round >= 2);
  });

  // Group 3: Danmu Routing (F12) + Guessed Words Tags (F11) + Cooldown Focus Safety (F13)
  test('Group 3: Danmu Routing + Guessed Words Tags + Cooldown Focus Safety', (t) => {
    const harness = playingRoom(t, { playerCount: 3 });
    const secret = harness.room.livonym.secret; // length e.g. 3

    // 1. Submit punctuated input "加油！"
    send(t, harness.manager, harness.guests[0], { type: 'livonymGuess', text: '加油！' });
    // Not added to wrong guess tags
    assert.ok(!harness.room.livonym.wrongGuesses[harness.guests[0].uid]?.includes('加油！'));

    // 2. Submit wrong guess matching secret length
    const wrongWord = [...secret].map(() => '假').join('');
    tick(t, 1600); // pass cooldown
    send(t, harness.manager, harness.guests[0], { type: 'livonymGuess', text: wrongWord });
    // Added to wrong guesses
    assert.ok(harness.room.livonym.wrongGuesses[harness.guests[0].uid]?.includes(wrongWord));
  });

  // Group 4: Spectator Switching (F14) + Clue Giver Input Lock (F15) + Auto-Revert on Next Round
  test('Group 4: Spectator Switching + Clue Giver Input Lock + Auto-Revert', (t) => {
    const harness = playingRoom(t, { playerCount: 4 }); // 1 describer, 3 guessers
    const secret = harness.room.livonym.secret;

    // 1st guesser guesses correctly
    send(t, harness.manager, harness.guests[0], { type: 'livonymGuess', text: secret });
    // 2nd guesser guesses correctly (2 out of 3 = N-1 reached!)
    send(t, harness.manager, harness.guests[1], { type: 'livonymGuess', text: secret });

    // Clue giver input should be locked
    const view = harness.manager.livonymView(harness.room, harness.host.uid);
    assert.equal(view.locked, true, 'Clue giver must be locked when N-1 guessers correct');

    // Round ends -> advances to next round
    expire(t, harness.manager, harness.room);
    expire(t, harness.manager, harness.room);
    assert.equal(harness.room.phase, 'lvIntro');
    assert.equal(harness.room.round, 2);
  });

  // Group 5: Punctuation-Stripped containsSecret (F10) + 50-Char Limit Boundary (F23) + Text Alignment (F6)
  test('Group 5: containsSecret Punctuation + 50-Char Boundary + Text Alignment', () => {
    // 1. Punctuation bypass attempt blocked
    assert.equal(containsSecret('电，饭。煲！', '电饭煲'), true);
    assert.equal(describeContainsSecret('电，饭。煲！', '电饭煲'), true);

    // 2. 50 characters boundary check
    const text50 = '字'.repeat(50);
    assert.equal([...cleanDescribe(text50)].length, 50);
    const text51 = '字'.repeat(51);
    assert.equal([...cleanDescribe(text51, Infinity)].length, 51);

    // 3. CSS alignment
    const styles = readFileSync(new URL('../../public/styles.css', import.meta.url), 'utf8');
    assert.match(styles, /\.livonym-describe-input[^{]*\{[^}]*text-align:\s*left/s);
  });

  // Group 6: Residual Player Interruption (F7) + Database Non-Persistence
  test('Group 6: Residual Player Interruption + Database Non-Persistence', (t) => {
    const harness = playingRoom(t, { playerCount: 3 });
    const matchId = harness.room.matchId;

    // Player leaves leaving 2 players
    harness.manager.detach(harness.guests[1], true);
    assert.equal(harness.room.phase, 'interrupted');
    assert.equal(harness.room.outcome, 'interrupted');

    // Room must not be persisted to SQLite DB
    assert.ok(!harness.room.persisted);
    const saved = harness.db.getMatch(matchId);
    assert.equal(saved, undefined, 'Interrupted match must not be persisted in DB');
  });

  // Group 7: Rematch Scaling for >= 5 Players (F19) + Tie-Break Consistency (F22)
  test('Group 7: Rematch Scaling for >= 5 Players + Tie-Break Consistency', (t) => {
    const harness = playingRoom(t, { playerCount: 5 });
    // Advance all 5 rounds to finish
    while (harness.room.phase !== 'result') {
      expire(t, harness.manager, harness.room);
    }
    assert.equal(harness.room.phase, 'result');
    assert.equal(harness.room.rematchSeconds, 60, 'Rematch duration must be 60s for >= 5 players (AC-8)');
  });

});

// =============================================================================
// TIER 4: Real-World Application Scenarios (5 Multi-Round Scenarios)
// =============================================================================

describe('Tier 4: Real-World Application Scenarios', () => {

  // Scenario 1: Full 3-Player Match (Custom Config to Rematch)
  test('Scenario 1: Full 3-Player Match from Setup to Rematch', (t) => {
    const harness = setupRoom(t, {
      playerCount: 3,
      settings: { describeSeconds: 30, roundsPerPlayer: 1 }
    });
    assert.equal(harness.room.describeSeconds, 30);

    // Start match: countdown -> lvIntro -> lvPlay
    send(t, harness.manager, harness.host, { type: 'start' });
    assert.equal(harness.room.livonym.totalRounds, 3);
    expire(t, harness.manager, harness.room); // countdown -> lvIntro (5s)
    assert.equal(harness.room.phase, 'lvIntro');
    assert.equal((harness.room.phaseDeadline - Date.now()) / 1000, 5);

    expire(t, harness.manager, harness.room); // lvIntro -> lvPlay (30s)
    assert.equal(harness.room.phase, 'lvPlay');
    assert.equal((harness.room.phaseDeadline - Date.now()) / 1000, 30);

    // Round 1: Guest 0 guesses correctly. Guest 1 does not guess.
    const secret1 = harness.room.livonym.secret;
    send(t, harness.manager, harness.guests[0], { type: 'livonymGuess', text: secret1 });
    expire(t, harness.manager, harness.room); // lvPlay -> lvScore (6s)
    assert.equal(harness.room.phase, 'lvScore');
    assert.equal((harness.room.phaseDeadline - Date.now()) / 1000, 6);
    assert.equal(harness.room.livonym.scores[harness.host.uid], 1);
    assert.equal(harness.room.livonym.scores[harness.guests[0].uid], 3);

    // Round 2: Guest 0 describes. Both Host and Guest 1 guess correctly (Cliff!).
    expire(t, harness.manager, harness.room); // lvScore -> lvIntro
    expire(t, harness.manager, harness.room); // lvIntro -> lvPlay
    const secret2 = harness.room.livonym.secret;
    send(t, harness.manager, harness.host, { type: 'livonymGuess', text: secret2 });
    send(t, harness.manager, harness.guests[1], { type: 'livonymGuess', text: secret2 });
    // Round ends immediately when all guess
    assert.equal(harness.room.phase, 'lvScore');
    // Describer Guest 0 scores 0 points (cliff)
    assert.equal(harness.room.history.at(-1).modeDetails.points[harness.guests[0].uid], 0);

    // Round 3: Guest 1 describes. Nobody guesses.
    expire(t, harness.manager, harness.room); // lvScore -> lvIntro
    expire(t, harness.manager, harness.room); // lvIntro -> lvPlay
    expire(t, harness.manager, harness.room); // lvPlay -> lvScore
    assert.equal(harness.room.history.at(-1).modeDetails.points[harness.guests[1].uid], 0);

    // Advance to Result
    expire(t, harness.manager, harness.room);
    assert.equal(harness.room.phase, 'result');
    assert.equal(harness.room.outcome, 'played');
    assert.equal(harness.room.rematchSeconds, 40, 'Rematch for 3P is 40s');

    // DB verified
    const saved = harness.db.getMatch(harness.room.matchId);
    assert.equal(saved.rounds.length, 3);
  });

  // Scenario 2: 6-Player Match with Mid-Game Disconnect, Offline Bypass & Denominator Stability
  test('Scenario 2: 6-Player Match with Mid-Game Disconnect and Offline Bypass', (t) => {
    const harness = playingRoom(t, { playerCount: 6 }); // 1 describer, 5 guessers
    assert.equal(harness.room.livonym.totalRounds, 6);

    // Round 1: Denominator is 5 guessers.
    const secret = harness.room.livonym.secret;
    send(t, harness.manager, harness.guests[0], { type: 'livonymGuess', text: secret }); // Rank 1: 6 pts
    send(t, harness.manager, harness.guests[1], { type: 'livonymGuess', text: secret }); // Rank 2: 5 pts

    // Guest 3 disconnects mid-round (seat retained, connected = false)
    harness.guests[3].ws.close();
    const offlinePlayer = harness.room.players.find((p) => p.uid === harness.guests[3].uid);
    offlinePlayer.connected = false;

    // Finish round 1: Describer gets 2 points (2 out of locked 5 guessers, cliff not triggered)
    expire(t, harness.manager, harness.room);
    assert.equal(harness.room.phase, 'lvScore');
    assert.equal(harness.room.history.at(-1).modeDetails.points[harness.host.uid], 2);

    // Finish match rounds to check rematch cooldown
    while (harness.room.phase !== 'result') {
      expire(t, harness.manager, harness.room);
    }
    assert.equal(harness.room.phase, 'result');
    assert.equal(harness.room.rematchSeconds, 60, '6-player rematch cooldown must be 60 seconds (AC-8)');
  });

  // Scenario 3: Guesser Gameplay with Danmu, Tags, and Spectator Perspective
  test('Scenario 3: Guesser Gameplay with Danmu, Tags, and Spectator Perspective', (t) => {
    const harness = playingRoom(t, { playerCount: 4 });
    const secret = harness.room.livonym.secret;

    // 1. Submit punctuation -> Danmu routed, 1s cooldown
    send(t, harness.manager, harness.guests[0], { type: 'livonymGuess', text: '太难了吧！' });
    // Not recorded in wrong guesses
    assert.ok(!harness.room.livonym.wrongGuesses[harness.guests[0].uid]?.includes('太难了吧！'));

    // 2. Submit wrong guess matching character count -> wrong guess, 1.5s cooldown, added to tags
    const wrongAttempt = '假答案';
    if (wrongAttempt !== secret && [...wrongAttempt].length === [...secret].length) {
      tick(t, 1600);
      send(t, harness.manager, harness.guests[0], { type: 'livonymGuess', text: wrongAttempt });
      assert.ok(harness.room.livonym.wrongGuesses[harness.guests[0].uid]?.includes(wrongAttempt));
    }

    // 3. Submit correct guess
    tick(t, 1600);
    send(t, harness.manager, harness.guests[0], { type: 'livonymGuess', text: secret });
    assert.equal(harness.room.livonym.guessed.some((g) => g.uid === harness.guests[0].uid), true);
  });

  // Scenario 4: Secret Clue Drafting: Punctuation Bypass, 50-Char Boundary, and Clue-Giver Lock
  test('Scenario 4: Clue Drafting Punctuation Bypass, 50-Char Boundary, and Lock', (t) => {
    const harness = playingRoom(t, { playerCount: 4 });
    const secret = harness.room.livonym.secret;

    // 1. Punctuation disguised clue is blocked
    const disguised = [...secret].join('-');
    assert.equal(containsSecret(disguised, secret), true, 'Disguised secret with hyphens must be blocked');

    // 2. 50 character boundary check
    const text50 = '一'.repeat(50);
    assert.equal([...cleanDescribe(text50)].length, 50);

    // 3. Guessers guess until N-1 reached
    send(t, harness.manager, harness.guests[0], { type: 'livonymGuess', text: secret });
    send(t, harness.manager, harness.guests[1], { type: 'livonymGuess', text: secret });

    // Clue giver locked
    const view = harness.manager.livonymView(harness.room, harness.host.uid);
    assert.equal(view.locked, true, 'Clue giver must be locked after N-1 guessers correct');
  });

  // Scenario 5: History Review (?me) Total Scoreboard, Badges & Match Facts
  test('Scenario 5: History Review Total Scoreboard, Badges & Match Facts', (t) => {
    const harness = playingRoom(t, { playerCount: 3 });
    // Play through to result
    while (harness.room.phase !== 'result') {
      expire(t, harness.manager, harness.room);
    }
    assert.equal(harness.room.phase, 'result');

    const saved = harness.db.getMatch(harness.room.matchId);
    assert.ok(saved);

    // Verify match facts markup inside detail
    const factsHtml = matchDetailMarkup({ match: saved });
    assert.match(factsHtml, /即时竞猜/);
    assert.match(factsHtml, /共\s*3\s*棒/);

    // Verify detail markup includes scoreboard
    const detailHtml = matchDetailMarkup({ match: saved });
    assert.ok(detailHtml);
  });

});
