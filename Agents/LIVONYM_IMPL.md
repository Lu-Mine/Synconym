# Livonym 即时竞猜 · 实现方案

本文把 `Agents/MODES_DESIGN.md` §二（即时竞猜 / Livonym）的设计意图，细化成可以直接照着写代码、写测试的实施方案。玩法方向以计划文档为准；本文只补充它没定死、但落地时必须有唯一答案的部分：阶段划分、消息协议、可见性、限流、数据库字段与逐文件改动点。

> 行号来自当前工作区快照（含未提交改动），会漂移；落地时以文中给出的符号名（函数名、消息类型、DOM id）为准。

---

## 一、规则收敛

计划文档给了机制与观感，下面是必须确定的实现细节。每一条都带默认值，未特别说明即为默认行为。

### 1.1 人数与轮替

| 项 | 取值 | 说明 |
|---|---|---|
| 开局人数 | 3–8 人 | 少于 3 人不允许开局（出题人 1 + 竞猜者 ≥2） |
| 轮替顺序 | 开局时按座位顺序锁定 | 复用现有 `seat`（大厅顺序），开局后中途重连不改变顺序 |
| 每局轮数 | `在线人数 × roundsPerPlayer`，`roundsPerPlayer` 默认 1 | 玩家集合在开局时快照为 `livonym.order`，中途退出不补位、不缩短 |
| 中途加入 | 不允许 | 沿用现有「仅 lobby 可加入」（`server/rooms.js:635`） |

### 1.2 阶段与时长

| 阶段 | 时长 | 内容 |
|---|---|---|
| `countdown` | 5 秒（复用） | 开场，展示本局出题顺序与人数 |
| `lvIntro` | 3 秒（固定） | 交给下一位出题人：出题人看到秘密词，其他人看到「X 正在准备」 |
| `lvPlay` | `describeSeconds`，默认 45，可选 30/45/60 | 出题人实时打字，竞猜者流式阅读并抢猜 |
| `lvScore` | 8 秒（固定） | 本轮看板：秘密词、猜中顺序与得分、当前总分 |
| `result` / `interrupted` | 复用现有 | 见 §五 |

`lvIntro` 是计划文档没有、但必须补的一环：出题人需要时间读词，其他人需要知道「轮到谁」，否则 45 秒会被读词吃掉。

### 1.3 计分

计分只服务一个目标：描述方要**想办法让人猜到，但别让所有人都猜到**，更不能把答案写出来。

**出题人（描述方）本轮得分**，自上而下取第一条命中：

| 条件 | 得分 | `lvScore` / 结算页给的原因 |
|---|---|---|
| 本轮所有在线竞猜者都猜中 | 0 | 全都猜中了 |
| 其余 | 每有 1 人猜中 +1 | 「4 人猜中」 |

三条要点：

1. **线性加分制造取舍**：猜到的人越多分越高，但「全中归零」是一条悬崖——最后一两个人有没有被猜到，直接决定这轮是接近满分还是 0 分。描述方只能主动控制节奏：够清楚，又留一手。
2. **无人猜中自然得 0**：不需要额外规则，0 人猜中就是 0 分，顺带堵住「越玄越好」。
3. **只看猜中人数，不看猜错次数**：猜错次数能被别人故意喂高，猜中人数不能；同时时间指标也不参与计分，慢慢打字骗不到分。

分母是**本轮在线的竞猜者**：掉线者不计入「所有人」，否则一人掉线就永远拿不到分。只剩 1 位在线竞猜者时，他一猜中即等于全中，出题人得 0 分（残局，可接受）。

得分上限 = 在线竞猜者人数 − 1，所以**不同人数的局不可横向比较**：3 人局出题人每轮最多 1 分，8 人局最多 6 分。结算与轮次回顾里标注「本轮满分 M−1」，让分数在同一局内说得清。

**竞猜者本轮得分**（不变）：第 1 个猜中 3 分、第 2 个 2 分、其余 1 分、未猜中 0 分。猜错不扣分，只有 1.5 秒冷却；抢在别人前面猜中才有分，所以没有不猜的理由。

系数只有两个数，集中在 `server/livonym.js`：

```js
export const LIVONYM_SCORE = { perGuess: 1, allGuessed: 0 };
// 出题人：guessedCount >= guesserCount ? allGuessed : guessedCount * perGuess
```

示例：

- 3 人局（1 出题人 + 2 竞猜者）：1 人猜中 → 1 分；2 人全中 → 0 分；无人猜中 → 0 分。
- 6 人局（1 出题人 + 5 竞猜者）：3 人猜中 → 3 分；4 人猜中 → 4 分；5 人全中 → 0 分。

名次由服务端收到 `livonymGuess` 的处理顺序决定（Node 单线程串行，天然无竞态）。同一玩家一轮只能得一次分。

### 1.4 猜测判定

- 归一化函数直接复用 `normalizeWord`（`server/rules.js:10`）：繁简归一、全角转半角、去空白、小写。
- 判定为**完全相等**，不做包含或近义（近义无法判定，且会让名次失去意义）。
- 猜错：只回执本人，不广播、不打扰他人；猜错不影响任何人的得分，只为下一次猜中付出 1.5 秒冷却。
- 冷却：同一玩家两次提交间隔 ≥ 1500ms，超限静默拒绝（不回 toast，只在前端禁用输入）。
- 猜词框（竞猜者）保持经典词规则：`cleanWord`、1–12 个汉字/字母/数字、单行、回车提交。上面的放宽只作用于出题人的描述框。

### 1.5 描述文本的约束

- **只挡「不能写」的，不挡「怎么写」**：描述框接受汉字、字母、数字、常见符号、emoji 与全部 Unicode 标点（逗号、破折号、引号、括号、省略号都算），也接受换行，连续空行折叠成一个。不能沿用只留「汉字·字母·数字」的 `cleanWord`——那是给词用的，12 字上限会把描述憋死。
- **多行输入**：`#describe-input` 用 `textarea`，允许分行描述（分点、逐行递进），流式区用 `white-space: pre-wrap` 原样呈现换行；高度随内容自动增高，不回退成滚动条。
- **字符上限 400**，按 code point 计数（约 400 个汉字，或 100 个 emoji）。45 秒里中文正常打字约 60–90 字，400 字符是防滥用的人为上限，几乎碰不到；前端在 `input` 事件里**截断**而不是拒绝输入，服务端只做兜底，超长整条拒绝并回 `livonymBlocked { reason: 'tooLong' }`。
- **不加 `maxlength` 属性**：沿用现有 `#word-input` 的做法，限制交给 JavaScript，避免浏览器原生截断吃掉输入法候选。
- 清洗函数与 `cleanWord` 并排放在 `public/app.js`，便于单独测试：

```js
const INVISIBLE = /[\p{Cc}\u200b\u200c\ufeff]/u;   // 注意 \p{Cc} 含换行，换行要单独放行
const KEEP_NEWLINE = (char) => char === '\n' || !INVISIBLE.test(char);
function cleanDescribe(value, max = 400) {
  const folded = [...value.normalize('NFC')].filter(KEEP_NEWLINE).join('');
  return [...folded.replace(/[^\S\n]+/gu, ' ').replace(/\n{2,}/gu, '\n')].slice(0, max).join('');
}
```

- **禁止直接写出谜底**：服务端按「归一化后的文本包含归一化后的完整秘密词」判定并拒收，回执 `livonymBlocked`，只挡这一条输入，**不影响本轮得分**。前端收到拦截后回退输入框，并在输入框下方提示「写出谜底会被拦下」。单字不拦（谜底是「高压锅」时应允许打出「锅」），否则文本无法书写。
- 不做拼音/同义词拦截：无法可靠判定，规则上也不属于「直接写出」。

### 1.6 结束与异常

| 情况 | 处理 |
|---|---|
| 本轮所有在线竞猜者都猜中 | 立即进 `lvScore`，不等到期 |
| 45 秒到期 | 进 `lvScore` |
| 出题人掉线 | 本轮立即中止，按已发生的猜中结算后进 `lvScore`，下一棒顺延；不等重连（重连席位仍保留 90 秒） |
| 竞猜者掉线 | 不影响本轮；重连回到当前流 |
| 在线玩家 < 2 | 进 `interrupted`（复用现有「只剩一位玩家中断」路径） |
| 打满全部棒次 | `settle` → `result`，`outcome = 'played'` |
| 主动退出 | 立即移除席位；`livonym.order` 不重排，被移除者的棒次跳过 |

---

## 二、状态机

```
lobby ──start(3–8 人)──► countdown ──5s──► lvIntro ──3s──► lvPlay ──45s / 全猜中──► lvScore ──8s──┐
                                                                                                │
                    ┌──────────────────── 还有下一棒 ────────────────────────────────────────────┘
                    └──────────────────── 所有棒次完成 ──► settle ──► result ──► rematch / lobby
```

服务端落点（`server/rooms.js`）：

| 现有函数 | 改动 |
|---|---|
| `start`（:744） | `mode === 'livonym'` 时改为初始化 `room.livonym`（order/总轮数/清零分数）、`matchId`、`startedAt`，进 `countdown`；人数校验按模式容量 |
| `advanceDeadline`（:496） | 加 `lvIntro → startLivonymRound`、`lvPlay → finishLivonymRound`、`lvScore → nextLivonymRound` |
| `checkProgress`（:387） | 中断白名单加 `lvIntro/lvPlay/lvScore`；livonym 阶段不执行经典写词/投票推进分支 |
| `settle`（:408） | livonym 的每轮记录走 `modeDetails`（见 §五）；`outcome='played'` |
| `finishRematch`（:457） | 重置键列表（:481）加 `'livonym'`；`restart` 分支同样按模式重置 |

新增函数（建议都放 `server/rooms.js` 内，与现有阶段函数并列，纯计算抽到新文件 `server/livonym.js`）：

- `startLivonymRound(room)`：推进 `index`，抽秘密词（不与 `used` 重复），清空 `stream` / `guessed` / `roundPoints`，进 `lvIntro`。
- `beginLivonymPlay(room)`：`lvIntro` 到期，进 `lvPlay`，重置 `player.lastStreamAt/lastGuessAt`。
- `finishLivonymRound(room, aborted = false)`：按 §1.3 算本轮每人得分写入 `roundPoints` 并累加到 `scores`，写 `room.currentRecord`，进 `lvScore`。
- `nextLivonymRound(room)`：`index + 1 < totalRounds` 则 `startLivonymRound`，否则 `settle`。
- `applyLivonymStream(room, player, text)`：谜底拦截 + 更新 `stream` + 广播 delta。
- `applyLivonymGuess(room, player, text)`：冷却、判等、定名次、计分、广播。

---

## 三、协议

### 3.1 客户端 → 服务端（新增）

| 消息 | 载荷 | 约束 |
|---|---|---|
| `livonymStream` | `{ text, rev }` | 仅当前出题人，仅 `lvPlay`；服务端最小间隔 60ms，超限**静默丢弃**（流式抖动不弹错误）；`text` ≤ 400 字符，超长整条拒绝并回 `livonymBlocked { reason: 'tooLong' }` |
| `livonymGuess` | `{ text }` | 仅竞猜者，仅 `lvPlay`，本人未猜中；1.5 秒冷却 |
| `livonymSkip` | `{}` | 预留：出题人放弃本轮（默认不实现，见 §十二 待确认 4） |

### 3.2 服务端 → 客户端（新增）

| 消息 | 载荷 | 接收者 |
|---|---|---|
| `livonymStream` | `{ describerUid, text, rev, serverNow }` | 同房其他人（出题人本人不回显，避免自激） |
| `livonymGuessResult` | `{ ok, text, order?, points?, reason? }` | 只发提交者；`reason: 'wrong' \| 'cooldown' \| 'closed'` |
| `livonymGuessed` | `{ uid, name, order, inMs }` | 同房所有人（不含猜测内容） |
| `livonymBlocked` | `{ reason: 'secret' \| 'tooLong', text }` | 只发该出题人；前端回退输入框并提示「写出谜底会被拦下」（`tooLong` 的提示为「描述超出上限」） |

命名与 `Agents/MODES_DESIGN.md` §6.2 的 `livonym_stream` 不同：本仓库协议一律 camelCase（`submitWord`、`breakVote`、`updateSettings`），这里跟随仓库惯例；`MODES_DESIGN.md` 的蛇形写法视为草案。

### 3.3 与既有协议的关系

- 不新增 `mode` 之外的房间设置消息：`createRoom` / `updateSettings` 复用，新增两个字段（§4.1）。
- livonym 阶段不接受 `submitWord` / `vote` / `breakVote` / `ready` 等经典消息，落入现有 `default` 分支（`server/rooms.js:787`）即「当前阶段不支持此操作」。
- 流式与猜测走**独立消息**，不进 `state` 全量广播，理由见 §6。

---

## 四、服务端改动

### 4.1 房间设置（`server/rules.js`）

```js
export const DEFAULT_SETTINGS = Object.freeze({
  mode: 'free', maxRounds: 12, writeSeconds: 45, prepareSeconds: 30, banRepeat: true,
  describeSeconds: 45, roundsPerPlayer: 1
});
```

- `validateSettings`（:28）的 `mode` 白名单扩为 `['free', 'theme', 'livonym']`。
- `describeSeconds` ∈ `[30, 45, 60]`，`roundsPerPlayer` ∈ `[1, 2]`。
- livonym 模式下 `maxRounds / writeSeconds / prepareSeconds / banRepeat` 仍接受并保留（旧快照、DB、回房间路径都能读到），但**不参与** livonym 流程。
- 新增 `MODE_CAPACITY = { free: 4, theme: 4, livonym: 8 }` 与 `modeCapacity(mode)`，供 `joinRoom`、`start`、`/api/rooms/:code` 共用。

### 4.2 座位扩到 8（`server/rooms.js:552`）

`addPlayer` 里 `[0, 1, 2, 3].find(...)` 改为 `[0…7]`。容量校验点共三处，必须同步：

| 位置 | 现状 | 改为 |
|---|---|---|
| `server/rooms.js:636` | `players.length >= 4` → 「房间已满」 | `>= modeCapacity(target.mode)` |
| `server/rooms.js:747` | `< 2 \|\| > 4` → 「需要 2 到 4 人」 | livonym：`< 3 \|\| > 8`；其它：`< 2 \|\| > 4` |
| `server/index.js:69` | `/api/rooms/:code` 的 `>= 4` 预先校验 | `>= modeCapacity(room.mode)` |

### 4.3 秘密词库（新文件 `data/livonym-words.json`）

`data/themes.json` 只有 20 个主题（`{ id, name }`），不含词表，不能当出题来源。新建：

```json
{ "version": 1, "words": ["高压锅", "地铁", "影子", "潮汐", "闹钟"] }
```

- 规模 ≥ 400，选词标准：具体名词、2–4 字、可被描述、无强地域/时效/专有名词、不与另一词同形。
- 抽词用 `this.random`（与 `makeCode` 一致），同局不重复：`room.livonym.used`。
- 文件缺失或为空时启动失败并在 `/healthz` 之前抛出（与 `themes.json` 用 `readFileSync` 的行为一致），不做静默降级。

### 4.4 房间内存与快照（`sendState`，`server/rooms.js:148`）

内存结构：

```js
room.livonym = {
  order: ['UID_A', 'UID_B', 'UID_C'],   // 开局锁定
  index: 0,                             // 当前棒次
  totalRounds: 3,
  secret: '高压锅',
  stream: { text: '', rev: 0 },
  guessed: [{ uid, order, atMs }],       // 本轮猜中顺序
  roundPoints: { UID_A: 1, UID_B: 3 },   // 本轮各人得分，进 lvScore 前结算
  scores: { UID_A: 0, UID_B: 0, UID_C: 0 },
  used: ['高压锅'],
  fastest: { uid, ms } | null           // 仅用于「神猜」称号，不参与计分
};
```

`describerUid = order[index % order.length]`；若该位已离开房间，`nextLivonymRound` 顺次跳过。出题人与竞猜者的划分只由这一个字段导出，服务端不另存角色。

快照按连接定制（现有先例：`password` 只发给房主，:160）：

```js
livonym: room.livonym ? {
  index, totalRounds, describerUid, describerName,
  describeSeconds, streamText: room.livonym.stream.text, streamRev: room.livonym.stream.rev,
  secret: (room.phase === 'lvScore' || room.phase === 'result' || connection.uid === describerUid) ? room.livonym.secret : null,
  guessed: room.livonym.guessed,
  guessers: [{ uid, name }],              // 在线竞猜者名单：猜中列表为每人留一行空态
  guesserCount: guessers.length,           // 计分分母与名单同源
  scores: room.livonym.scores,
  roundPoints: ['lvScore', 'result'].includes(room.phase) ? room.livonym.roundPoints : null,
  mine: me.livonym ? { text, ok, order, at } : null,
} : null
```

可见性矩阵：

| 字段 | 出题人 | 竞猜者 | 阶段 |
|---|---|---|---|
| `secret` | ✅ | ❌ | `lvIntro` / `lvPlay` |
| `secret` | ✅ | ✅ | `lvScore` / `result`（本轮已结束） |
| `streamText` | ✅（自己的回填） | ✅ | `lvPlay` |
| `guessed` | ✅ | ✅ | `lvPlay` |
| 竞猜者猜错文本 | — | 仅本人 | 任意 |

### 4.5 限流（`server/rooms.js:571-576`）

现有两条通道：`typing/draft` 300ms、其余写操作 500ms。新增第三条：

```js
const streaming = type === 'livonymStream';
const guessing = type === 'livonymGuess';
const interval = streaming ? 60 : guessing ? 1500 : typing ? 300 : 500;
```

- `streaming` 超限**不抛错**，直接 `return`（流式抖动是常态，抛错会在前端弹 toast）。
- `guessing` 超限回 `livonymGuessResult { ok: false, reason: 'cooldown' }`，不抛错。
- `typing`/`draft` 与经典模式保持原样。

---

## 五、结算与持久化

### 5.1 落库（`server/db.js`）

- `matches.mode` 直接存 `'livonym'`，无需改表。
- `match_rounds` 新增列 `mode_details_json`，沿用 `server/db.js:94-95` 的 `ALTER TABLE` 增量迁移写法。
- `saveMatch` 的 `insertRound` 增加该列，写入：

```js
{ secret, describerUid, guesses: { uid: { text, order, atMs } }, points: { uid: n }, guesserCount, aborted }
```

- 经典模式的 `words_json` 仍写入（`{ [describerUid]: secret }`），`marks_json` 全 `'none'`，让档案页与详情页现有的空值分支不至于报错。

### 5.2 结算页（`public/render.js:876`）

`resultMarkup` 增加 livonym 分支 `livonymResultMarkup(state)`：

- 总分榜：按 `scores` 降序，同分按最早猜中时间。
- 称号：`竞猜王`（竞猜得分最高）、`速记员`（作为出题人得分最高）、`神猜`（全局限时内最快猜中，显示毫秒）、`最佳描述`（单轮出题得分最高次数最多）。
- 逐轮回顾里同时给出本轮得分与原因文案（「N 人猜中」/「全都猜中了」/「没人猜中」/「写出了谜底」），并标注本轮满分（在线竞猜者数 − 1）。
- 逐轮回顾替代「词路径」：每轮秘密词 + 猜中顺序 + 本轮得分。`resultPathMarkup` 复用不了（它按 `words/marks` 渲染）。
- `rematchMarkup` 原样复用；`resultSummary`（:805）与 `matchDetailMarkup`（:953）各加一条 `outcome === 'played'` 文案分支，否则会落到「走过 N 轮，留下了这些不同的想法」这种不合语义的默认句。

---

## 六、流式与广播策略

| 通道 | 消息 | 频率上限 | 接收者 | 单条大小 |
|---|---|---|---|---|
| 描述流 | `livonymStream`（独立消息，整段文本） | 12.5 条/秒/出题人（80ms 节流） | n−1 ≤ 7 | 典型 200–300 B，上限约 1.2 KB（400 字符，含换行） |
| 猜中事件 | `livonymGuessed` | 每轮 ≤ 7 条 | 所有人 | ≈120 B |
| 全量快照 | `state` | 仅阶段切换与猜中 | 所有人 | 2–6 KB（随 history 增长） |

- 服务端每次 `livonymStream` 只转发这条独立消息，**不进 `state` 广播**：典型房间峰值 ≈ 12.5 × 7 × 0.3 KB ≈ 26 KB/s，400 字符打满时 ≈ 12.5 × 7 × 1.2 KB ≈ 105 KB/s；若走全量快照则是 ≈ 12.5 × 8 × 4 KB ≈ 400 KB/s，且每次都会触发客户端 `render()`。
- 每连接限流桶（`server/security.js:12-13`：burst 60、refill 30/s）在 12.5 条/秒的稳态下不被击穿，**无需调整默认值**；`wsMaxPayload` 64 KB 也足够。
- 客户端节流 80ms（尾随），并在 `compositionend`/`input !isComposing` 后立即补发一次，保证中文输入法上屏不延迟。

---

## 七、前端改动

### 7.1 消息接入（`public/ws.js`）

- 构造函数 options 增加 `onLivonymStream`、`onLivonymGuessResult`、`onLivonymGuessed`、`onLivonymBlocked`（`public/ws.js:2`）。
- `message` 分发（:28）加 4 个分支。
- `send`（:108）对 `livonymStream` 不入队：未连接时直接丢弃，避免重连后补发一串过期文本。

### 7.2 阶段登记（`public/app.js`）

| 位置 | 改动 |
|---|---|
| `buildScreenMarkup`（:934） | 加 `lvIntro/lvPlay/lvScore → livonymMarkup(state, gameUi)` |
| `screenKeyFor`（:929） | 无需改（阶段名即 screen key），但 `lvPlay` 需要在 `replaceScene` 里额外接管焦点 |
| `patchSameScene`（:957） | 加 `lvPlay` / `lvScore` 增量分支：只 patch 玩家状态、得分、猜中列表，**保留 `#describe-input` / `#guess-input` 节点与焦点**（照抄 writing 分支 :997-1019 的做法） |
| `onState.phaseChanged`（:1234） | 写队列过滤白名单加 `livonymGuess`；`livonymStream` 从不入队 |
| `updateCountdown`（:439） | `lvPlay` 与 `lvIntro/lvScore` 都会命中通用 `#countdown` 逻辑，无需改；只需在 markup 里给 `#countdown` |
| `submit` 委托（:1342） | 加 `#guess-form`（回车提交）；描述框不提交，只走 input 事件 |
| `click` 委托（:1469） | 无需新动作（无按钮），`data-action="leave"` 复用 |
| `onError`（:1280） | 增加 `/谜底/` 命中时对 `#describe-input` 调 `markInvalid` |
| `input` 事件（:1390） | `#describe-input` 走 `cleanDescribe` 后按 80ms 尾随节流发 `livonymStream`；`event.isComposing` 时不发，`compositionend` 立即补发一次 |

### 7.3 渲染（`public/render.js`）

新增 `livonymMarkup(state, ui)`，内部按「我是不是出题人」分两套：

**出题人（`lvPlay`）**
- `#livonym-secret`：秘密词卡（大字，独立节点，不参与整体 patch）
- `#describe-input`：多行 `<textarea class="input" rows="1">`，**不带 `maxlength`**，输入即直播（无提交按钮），高度随内容自动增高；`aria-describedby` 指向「写出谜底会被拦下」
- `#livonym-guessed`：已猜中列表，实时追加；顶部常驻「已猜中 N / 共 M 人 · 全部猜中则本轮 0 分」，让取舍是明牌
- 无提交按钮；文案明确「打字即直播」

**竞猜者（`lvPlay`）**
- `#livonym-stream`：流式文本区，末尾 `i.livonym-caret` 光标；空文本时显示占位「等待描述…」；文本用 `textContent` 写入并自然折行，长句不改变周围布局
- `#guess-form` + `#guess-input`：沿用经典词输入（`cleanWord`、1–12 个汉字/字母/数字、单行）；回车提交，猜错时 `is-wrong` 抖动并禁用 1.5 秒，猜中后显示名次与得分
- 已猜中列表同上（含自己）

**`lvIntro`**：出题人看秘密词 + 「由你描述」；其他人看「X 正在准备描述」。3 秒倒计时。
**`lvScore`**：本轮秘密词、猜中顺序、每人本轮得分与原因（「4 人猜中」/「全都猜中了」/「没人猜中」/「写出了谜底」）、本轮满分、累计总分。

同一处需要同步：

- `stageProgressMarkup`（:377）硬编码三步，livonym 需要另一组步骤（`描述 / 抢猜 / 结算`）或对 livonym 返回空导航。
- `wordCardMarkup`（:779）的 `seat < 4` 改 `< 8`。
- `themeMarkup`（:120）在 livonym 下不显示主题（`mode === 'livonym'` 已天然为 false）。
- `settingsMarkup`（:81）：`settings.mode === 'livonym'` 时把「轮次上限 / 写词时限 / 准备时限 / 禁止重复词」四行替换为「描述时限 / 每人轮数」两行；模式行只显示 `Livonym` 英文艺术字，不加底色容器、不带中文名，可访问名由容器的 `aria-label="即时竞猜"` 提供。字形、配色与 `live-type` / `live-dot` 动效跟狂意页完全一致（同一个 `wordmarkArt` 与同一套 keyframes），只是不等 hover、常驻播放。字标色 `#bdcade` 本为深色底设计，浅色房间页上偏淡，这是「完全一致」的代价。
- `lobbyMarkup`（:621 的 `player-empty` 文案「2–4 人即可开玩」）按房间容量显示「3–8 人即可开玩」。

### 7.4 动效与布局（`public/motion.js`、`public/styles.css`）

- `PHASES`（`public/motion.js:3`）加 `lvIntro, lvPlay, lvScore`（顺带补上现有缺失的 `breakVote`，否则 `indexOf` 返回 −1 会算出错误方向）。
- 座位色扩到 8：`styles.css:19-22` 增加 `--player-4..7`，`:2094` 增加 `--card-player-4..7`。候选（需在设计稿里过一遍对比度）：`#E8A33D` / `#2FA8C8` / `#D3728C` / `#6E9B4E`。
- 流式区只用 `textContent` 更新，换行靠 `white-space: pre-wrap` 原样呈现，不触发 View Transition；打字光标闪烁受 `prefers-reduced-motion` 约束（与 `styles.css:120-123` 同款开关）。
- 8 人局布局：`lvPlay` 的已猜中列表在宽屏转两列、窄屏单列；描述区与猜测区上下堆叠，`#countdown` 固定在阶段条上（沿用 `.writing-clock`）。

### 7.5 入口解禁（`public/insane.js`）

- `modes` 项增加 `ready: true`（仅 livonym）。
- `insaneMarkup`（:56）：`ready` 的模式渲染可点的 `<button class="insane-create" data-action="create-insane-room" data-mode="livonym">`，点击后直接以固定配置（45 秒 / 每人 1 轮）创建房间并进入大厅，不回首页；其余模式保持 `disabled`。
- 首页设置面板不参与：livonym 只能从狂意页创建，首页的模式分段控件仍是自由 / 主题。
- 列表页文案（`insane.js:64`「玩法筹备中，暂未开放创建房间」）改为只在存在未开放模式时出现。

### 7.6 在线人数接口（`server/index.js:55`）

`/api/playing` 的阶段白名单加 `lvIntro / lvPlay / lvScore`，否则 Livonym 开局期间首页显示 0 人在玩。

---

## 八、实现顺序

每个里程碑都可独立合并、独立测试，前一步不依赖后一步。

| 里程碑 | 范围 | 验证 |
|---|---|---|
| **M-L1 规则层** | `server/livonym.js`（`LIVONYM_SCORE`、`describerPoints({ guessedCount, guesserCount })`、`guessPoints(order)`、`containsSecret`、`pickSecret`、`livonymOrder`）+ `rules.js` 设置扩展 + 词库文件 | 纯函数单测，无需网络 |
| **M-L2 服务端流程** | `rooms.js` 阶段函数、`sendState` 定制、限流三通道、容量、`index.js` 两处；`db.js` 迁移 | 内存库 + 真 ws 集成测试 |
| **M-L3 前端阶段** | `ws.js`、`app.js`（screen/增量 patch/委托）、`render.js` 两套视图、`motion.js`、`styles.css` 8 座色 | 渲染字符串断言 + Playwright 手测三人局 |
| **M-L4 结算与档案** | `livonymResultMarkup`、`resultSummary`/`matchDetailMarkup` 文案、落库往返 | 结算与详情页测试 |
| **M-L5 收尾** | `insane.js` 解禁、首页 mode 透传、`DESIGN.md`/`MODES_DESIGN.md` 同步 | 全量 `npm test` + 首页到结算走查 |

---

## 九、测试清单

沿用现有 `node --test` 惯例（`Agents/test/*.test.js`，`node:test` + `node:assert/strict`）。

| 文件 | 覆盖 |
|---|---|
| `Agents/test/livonym-rules.test.js` | 出题人计分（0 人猜中 0、1 人猜中 1、n 人猜中 n、全员猜中 0、只剩 1 位在线竞猜者时猜中即归零）、`guessPoints` 3/2/1、`containsSecret`（「锅」通过、「高压锅」拒绝、全角/繁简变体拒绝）、`pickSecret` 不重复、轮替顺序、注入 `random` 的抽词断言 |
| `Agents/test/livonym-rooms.test.js` | 3 人开局→3 棒→`result`；4 人 `roundsPerPlayer=2`→8 棒；全员猜中提前结束；到期结算；出题人掉线中止本轮并顺延；2 人继续、1 人 `interrupted`；`livonymGuess` 冷却拒绝；描述超 60ms 间隔被丢弃不报错；人数校验（2 人开局被拒、9 人加入被拒） |
| `Agents/test/livonym-stream.test.js` | 真 ws 三人局：出题人推流→另两人收到 delta、出题人自己收不到；`state` 里 `secret` 仅出题人有、`lvScore` 后全员可见；谜底命中回 `livonymBlocked` 且 `stream` 未变；猜错只回执本人；猜中广播顺序与积分一致；写出谜底被拦下后本轮出题人仍按猜中人数得分 |
| `Agents/test/livonym-ui.test.js` | `livonymMarkup` 两套视图的关键 id 与无障碍标签；`lvPlay` 空文本占位；8 座位色变量存在；`stageProgressMarkup` 对 livonym 不出现「写词/投票」；`cleanDescribe`（保留标点、emoji、换行，折叠连续空行，剔除 `\p{Cc}` 与零宽空格，保留 U+200D，400 字符处截断）、`#describe-input` 是 `textarea` 且不带 `maxlength` |
| `Agents/test/livonym-db.test.js` | `mode_details_json` 迁移幂等；`saveMatch`→`getMatch` 往返保留 `modeDetails`（含 `guesserCount`）；`outcome='played'` 在 `resultSummary`/`matchDetailMarkup` 的文案 |
| 回归 | `rooms.test.js`（容量与 `start` 文案）、`insane-page.test.js`（卡片解禁与 `ready` 文案）、`theme-ui.test.js`（`settingsMarkup` 分支）、`integration.test.js`（阶段白名单） |

---

## 十、风险与对策

| 风险 | 对策 |
|---|---|
| 中文输入法把拼音字母推给竞猜者 | `input` 事件用 `event.isComposing` 守卫，`compositionend` 再补发一次（`public/app.js:1390-1408` 已有同款写法） |
| 每次 state 都重建 DOM → 焦点丢失、流式区闪回 | `lvPlay` 走增量 patch（§7.2）；流式区只写 `textContent` |
| 秘密词泄漏 | `sendState` 按连接定制；`livonymStream` 只发他人；`history` 记录只在阶段结束后可见；测试用例专门断言矩阵 |
| 8 人座位越界 | `addPlayer` 与 `wordCardMarkup` 两处硬编码 `4` 同时改；用 8 人集成测试兜住 |
| 经典模式被回归 | livonym 分支全部以 `room.mode === 'livonym'` 为前提；经典测试套件全量跑 |
| 词库过小导致重复出题 | 同局 `used` 去重 + 词库 ≥ 400；词库少于 `8 × roundsPerPlayer` 时启动报错 |
| 人少的局出题人拿不到高分（3 人局上限 1 分） | 得分随人数线性放大；`lvScore` 与轮次回顾标注「本轮满分 M−1」，同一局内可比，跨局不比较 |
| 慢客户端被流式消息淹没 | 服务端 60ms 最小间隔 + WebSocket 自带背压；客户端 80ms 尾随节流（只保留最新文本） |

---

## 十一、验收标准

1. 三人局完整走通：`lobby → countdown → lvIntro → lvPlay → lvScore`（×3）`→ result`，全程无需点击除「创建 / 准备 / 开始 / 退出 / 重赛」以外的按钮。
2. 竞猜者屏幕上的文本与出题人输入框内容始终一致（含删改），延迟 < 200ms（局域网）。
3. 计分符合 §1.3：1 人猜中 1 分、n 人猜中 n 分、全员猜中 0 分、无人猜中 0 分；`lvScore` 与结算页给出与之一致的原因文案。
4. `state` 快照对竞猜者从不包含 `secret`（`lvScore` 前）；重连后流式文本与已猜中列表正确恢复。
5. `npm test` 全绿；新增用例覆盖 §九。
6. `prefers-reduced-motion` 下无光标闪烁与位移动画，倒计时与操作不受影响。
7. 8 人局在 1280 宽与手机竖屏下均无横向滚动，座位色不重复。
8. `Agents/DESIGN.md` §四 / §九 / §十 与新协议、新阶段、新设置同步（该文档 :414 要求页面改版同步更新）。
9. 描述框能输入含标点、换行与 emoji 的多行描述：换行被保留、连续空行折叠、不可见字符被剔除、400 字符处被截断，流式区按原样换行显示且不顶开周围布局。

---

## 十二、待确认

以下默认值已经按「最省事且不伤害玩法」选定，落地前如需改动，改这里再动代码：

1. 每人轮数默认 1 轮（可选 2 轮）——3 人局约 5 分钟。
2. 每轮结束公开秘密词（`lvScore` 起全员可见）。
3. 出题人**看不到**竞猜者猜错的内容，但实时看到「已猜中 N / 共 M 人」——这是本轮得分的直接依据，必须可见。
4. 不做「跳过本词 / 换一个词」，避免和 45 秒硬倒计时冲突。
5. 出题人掉线即中止本轮（不暂停等待），保证 45 秒节奏不被打断。
6. 竞猜者猜错的内容不落库，也不做计数（计分只看猜中人数）；档案页只有猜中的先后与文本。
7. 「每人猜中 +1、全员猜中归零」的系数集中在 `server/livonym.js` 的 `LIVONYM_SCORE`，方便调整松紧。
8. 描述框是 400 字符的多行框（`textarea` + `white-space: pre-wrap` 显示）；若要收紧回单行，把 `cleanDescribe` 里的换行折叠成空格即可，其余逻辑不动。

---

## 十三、实现记录

以下是与上文计划的差异，落地后以本节为准。

| 项 | 计划 | 实现 | 原因 |
|---|---|---|---|
| 描述框清洗函数 | `public/app.js` | `public/livonym.js` 的 `cleanDescribe` / `describeContainsSecret` | 独立模块才能被 `node --test` 直接导入，不必求值整个应用 |
| 谜底拦截 | 只在服务端 | 服务端权威，前端本地预检 | 出题人本来就知道谜底，本地拦一次零延迟；服务端负责兜底，拦截不扣分 |
| 结算称号 | 四个 | 三个（竞猜王 / 最佳描述 / 神猜） | 「最佳描述」已覆盖「单轮出题得分最高」，第四项与它重复 |
| `lvScore` 的秘密词来源 | `livonym.secret` | `history.at(-1).modeDetails` | 结算与逐棒回顾共用同一份记录，避免两处状态不同步 |
| `livonymGuessed` | 前端靠它追加列表 | 只作轻量事件，列表以随后的 `state` 为准 | 单一数据源；每轮最多 7 次，全量快照的成本可以忽略 |
| 词库规模 | ≥ 400 | 770（`data/livonym-words.json`） | 8 人 × 2 轮的最坏情况也够抽满不重复 |
| 入口解禁 | `insane.js` 单入口 | 卡片按钮直接发 `createRoom`（`data-action="create-insane-room"`，固定描述 45 秒 / 每人 1 轮），列表页文案改为「其余玩法仍在筹备中」 | 只有即时竞猜可创建；点一下就进房，不必回首页设置模式 |

同时修掉两个既有缺陷：

- `public/motion.js` 的 `PHASES` 补上 `breakVote` 与三个 `lv*` 阶段，方向判定不再落到 `indexOf` 的 −1。
- 大厅人数上限原来在 `patchLobbyDOM` 里硬编码 `/ 4`，改为按模式取 `roomCapacity(mode)`，否则 8 人房会被增量补丁改回 4 席。

- 档案条目原来把 livonym 对局写成「第 N 轮相遇」，改成「共 N 棒」，服务端档案摘要补上 `mode` 字段。

验证覆盖（`node --test` 413 项全绿，新增 `livonym-rules` / `livonym-rooms` / `livonym-ui` / `livonym-db` 四份）：

| 场景 | 手段 |
|---|---|
| 三人局整局：3 棒 → `lvScore` → `result` → 重赛 | Playwright，三页面独立身份 |
| 结算页总分榜（合计 15 分）、逐棒回顾按棒选页（3 棒 = 3 页，每页就是那一棒的本轮结算）、称号 | 同上 |
| 竞猜者刷新重连后恢复描述流、仍看不到秘密词 | 同上 |
| 出题人掉线 → 本轮中止 → 下一棒顺延 | 同上 |
| 输入法上屏后立即补发（`compositionend`） | 同上，派发合成事件 |
| 8 人房：8 席、8 种席位色、1280 与 375 宽无横向滚动 | 同上 |
| 设置改动落到服务端（刷新后仍是 60 秒 / 每人 2 轮） | 同上 |
| 狂意页按钮直接建房、字标与狂意页逐项一致、常驻动画、reduce 下关闭 | 同上 |
| 旧库补 `mode_details_json`、迁移幂等、`modeDetails` 往返、经典对局不带该列 | `livonym-db.test.js`（真实 SQLite） |

仍未覆盖：真实中文输入法的 `isComposing` 路径（只模拟了合成事件）、8 人局的实际对局视觉（`lvPlay` 猜中列表仍是单列，§7.4 写的宽屏两列没做）、非 Chromium 浏览器与触屏设备。

## 十四、狂意房间主题

即时竞猜的房间不再套用浅色大厅皮肤，改为与狂意页共用同一套场景：同一块画布、同一份深色色板。五种玩法共用一份判定，后续玩法落地不必再改这里。

| 项 | 位置 | 做法 |
|---|---|---|
| 玩法判定 | `public/render.js` 的 `INSANE_MODES` / `isInsaneMode` | 五种狂意玩法共用一份名单，房间与页面用同一个判断 |
| 主题挂载 | `public/app.js` 的 `isInsaneScene` / `syncInsaneTheme` | 狂意页与狂意玩法的房间同属一个场景：`body` 挂 `data-insane`，房间再挂 `data-insane-mode`；离开场景即删除，背景画布一并开关，普通场景与狂意场景互换时走侵蚀过场 |
| 背景 | `public/styles.css` 的 `body[data-insane]::before/::after` | 与狂意页同一组氛围色；`body.has-insane-gl` 时只留 WebGL 画布，不支持时回落静态渐变 |
| 上下文丢失 | `public/insane-background.js` 的 `fallBackToCss` | 丢失后移除 `has-insane-gl` 并停掉帧循环，画面交回 CSS 渐变；否则空白画布会盖住深色底，房间整屏发白 |
| 色板 | 同上 | 覆盖 `--card / --bg-subtle / --line / --ink / --accent` 等令牌，房间现有组件不改结构就变深色 |
| 玩法色 | `--mode-a` / `--mode-b` | 只用于舞台顶部的光、当前阶段、房号、猜中名次、描述光标与谜底微光 |
| 固定浅色 | 同文件「下列组件在浅色底上写了固定色」一段 | Toast、断线提示、空闲预警、已准备／房主／掉线徽标、投票结果色与开场倒计时各给一份深色取值 |

验证：`node --test` 416 项全绿（新增 `insane-room-theme` 一份；`motion-render` 的沙箱 harness 补上场景判定，`insane-page` 补了上下文丢失一条），并用 Playwright 走查「狂意页 → 创建即时竞猜 → 大厅加两名模拟玩家 → 开始 → 倒计时 → lvIntro → lvPlay 描述 → lvScore → 结算 → 退出房间」：逐屏确认 `data-insane`、背景画布与令牌取值，退出后属性清除并回落到浅色；自由模式房间作对照组保持原样；1280px 与 390px 均无横向溢出，正文与按钮对比度均 ≥ 4.5（品牌渐变字与阶段分隔点沿用原有处理）。
