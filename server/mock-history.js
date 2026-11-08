// 仅由隔离的 mock RoomManager 调用，不写入正式数据库。
export function seedMockHistory(manager, uid) {
  const db = manager.db;
  if (db.getMatch(`mock-history-${uid}-0`)) return;
  const user = db.getPlayer(uid);
  if (!user) return;
  const friends = [
    { uid: 'MOCK0001', name: '一起联想的朋友', seat: 1 },
    { uid: 'MOCK0002', name: '认真思考的橙子', seat: 2 },
    { uid: 'MOCK0003', name: '总有新点子的牛油果', seat: 3 }
  ];
  const now = Date.now();
  for (let i = 0; i < 24; i++) {
    const players = [{ uid, name: user.name, seat: 0 }, ...friends.slice(0, 1 + i % 3)];
    const outcome = ['exact', 'voted', 'none'][i % 3];
    const totalRounds = outcome === 'none' ? 12 : 2 + i % 5;
    const theme = i % 2 === 0;
    const vocabulary = theme ? ['海洋', '浪花', '沙滩', '贝壳', '海风', '帆船', '港口', '灯塔'] : ['苹果', '香蕉', '水果', '果园', '树木', '森林', '绿叶', '春天'];
    const rounds = Array.from({ length: totalRounds }, (_, index) => {
      const final = index === totalRounds - 1;
      const exact = final && outcome === 'exact';
      const words = Object.fromEntries(players.map((p, seat) => [p.uid, exact ? (theme ? '大海' : '丰收') : vocabulary[(index + seat) % vocabulary.length]]));
      const marks = Object.fromEntries(players.map(p => [p.uid, 'none']));
      if (i % 3 === 2 && index === 1) { words[players[1].uid] = ''; marks[players[1].uid] = 'empty'; }
      if (i % 3 === 2 && index === 2) { words[players[2].uid] = '[非法答案]'; marks[players[2].uid] = 'invalid'; }
      return { n: index + 1, words, marks, outcome: final && outcome !== 'none' ? outcome : 'miss',
        ...(exact ? {} : { votes: Object.fromEntries(players.map((p, seat) => [p.uid, final && outcome === 'voted' ? true : seat !== 0])) }) };
    });
    const endedAt = now - i * 86400000;
    db.saveMatch({ id: `mock-history-${uid}-${i}`, roomCode: ['12345', '23456', '34567'][i % 3],
      mode: theme ? 'theme' : 'free', themeId: theme ? 'ocean' : null,
      maxRounds: 12, totalRounds, convergedRound: outcome === 'none' ? null : totalRounds,
      outcome, startedAt: endedAt - totalRounds * 45000, endedAt, players, rounds });
  }
}
