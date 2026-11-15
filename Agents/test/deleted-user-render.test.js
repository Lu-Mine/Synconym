import test from 'node:test';
import assert from 'node:assert/strict';
import { profileMatchMarkup, deviceClaimItemsMarkup, deviceClaimHint } from '../../public/render.js';
import { validateName } from '../../server/rules.js';
import { DELETED_NAME } from '../../server/db.js';

const match = {
  id: 'm1', roomCode: '12345', mode: 'free', outcome: 'exact', convergedRound: 2,
  totalRounds: 3, startedAt: 1760000000000,
  players: [{ name: DELETED_NAME, deleted: true }, { name: '乙' }]
};

test('已注销玩家在档案里显示注销用户，头像带灰化标记', () => {
  const html = profileMatchMarkup(match, {}, { removable: true });
  assert.match(html, /\[注销用户\]/);
  assert.match(html, /data-avatar-deleted="true"/);
  assert.match(html, /data-action="delete-match" data-id="m1"/);
  assert.match(html, /aria-label="移除这一局（对手 \[注销用户\]、乙，/);
});

test('未被注销的玩家不带灰化标记', () => {
  const html = profileMatchMarkup({ ...match, players: [{ name: '乙' }] }, {});
  assert.doesNotMatch(html, /data-avatar-deleted/);
  assert.doesNotMatch(html, /data-action="delete-match"/);
});

test('已移除的记录给的是恢复入口', () => {
  const html = profileMatchMarkup(match, {}, { restorable: true });
  assert.match(html, /data-action="restore-match" data-id="m1"/);
  assert.doesNotMatch(html, /data-action="delete-match"/);
});

test('昵称不能再冒充注销用户', () => {
  assert.throws(() => validateName('注销用户'), /不能用/);
  assert.throws(() => validateName('[注销用户]'), /不能用/);
  assert.throws(() => validateName('我是注销用户'), /不能用/);
  assert.equal(validateName('正常人'), '正常人');
});

test('设备确认卡片列出只有本人知道的对局上下文', () => {
  const html = deviceClaimItemsMarkup([
    { uid: 'ABCD2345', name: '活泼的苹果', lastRoomCode: '12345', lastOpponentName: '安静的蓝莓' },
    { uid: 'EFGH6789', name: '安静的水蜜桃', lastRoomCode: null, lastOpponentName: null }
  ]);
  assert.match(html, /活泼的苹果/);
  assert.match(html, /房号 12345/);
  assert.match(html, /对手「安静的蓝莓」/);
  assert.match(html, /还没有对局记录/);
  assert.match(html, /data-action="device-claim-yes" data-uid="ABCD2345"/);
  assert.match(html, /data-action="device-claim-yes" data-uid="EFGH6789"/);
});

test('设备确认文案覆盖三种触发原因', () => {
  assert.match(deviceClaimHint('playing'), /另一处游玩/);
  assert.match(deviceClaimHint('multiple'), /多个身份/);
  assert.match(deviceClaimHint('confirm'), /确认一下/);
  assert.match(deviceClaimHint('unknown'), /多个身份/);
});
