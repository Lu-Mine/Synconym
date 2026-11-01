# Synconym 设计方案

> 两个人（或四个人）各自写一个词，同时揭晓，从上一轮的词继续靠近，直到想到同一个东西。
> 判定交给玩家投票，距离交给曲线，身份交给 uid。

状态：**待审阅**（v0.2）

## 变更记录

- **v0.2**：投票改为固定 5 秒同时投；引入回合间"准备"阶段；加入中途"玩崩了"投票；曲线移到结算页；设置改为离散档位；默认名改用 LocalSend 风格；明确超时未提交的展示规则
- **v0.1**：初版

---

## 一、入口

首页三种方式：

1. **创建房间** —— 可选模式（自由 / 主题）与各项设置，建完进等待大厅
2. **按房间号加入** —— 输入 4 位房号
3. **邀请链接直达** —— `/?r=CODE` 打开即进房，不需要输房号

---

## 二、房间设置

全部为离散档位，房主在创建时选择，**等待大厅内仍可修改**（开局后锁定）。

| 设置项 | 可选值 | 默认 |
|---|---|---|
| 轮次上限 | 4 / 8 / 12 / 16 / 20 | **12** |
| 写词时限 | 15 / 30 / 45 / 60 秒 | **45 秒** |
| 准备时限 | 15 / 30 / 45 / 60 秒 | **30 秒** |
| 投票倒计时 | 固定 5 秒 | 5 秒 |
| 模式 | 自由 / 主题 | 自由 |

以 switch 形式呈现，每项一行，左右箭头或分段控件切换。

---

## 三、等待大厅

- 房号 4 位（字符集去掉 `0/O/1/I/L`），创建即显示，可一键复制邀请链接
- **所有人准备即自动开始**，房主的准备不特殊，没有开始按钮，准备阶段无时限
- 准备期间可做的事：
  1. 查看房间设置（房主可改，非房主只读）
  2. 查看并复制房号与邀请链接
  3. 改自己的名字
  4. 邀请其他人（复制链接）
  5. 准备 / 取消准备
  6. 退出房间
- 实时显示每个人的准备状态
- 8 秒内可取消准备，防止误触

---

## 四、一局的流程

### 4.1 单轮状态机

```
writing ──全员提交/超时──▶ 判定
                            ├─ 全员写同一个词 ─────────────▶ 结算（成功）
                            └─ 否则 → voting(固定 5s)
                                        ├─ 全票通过 ───────▶ 结算（成功）
                                        └─ 未通过 → 弹窗提示 → prepare
prepare ──全员准备/超时──▶ 下一轮 writing
        └─（在轮次上限的 1/2 处）改为"崩局投票"
```

### 4.2 写词（writing）

- 所有人同时写，互不可见
- 提交后显示"已提交"，不泄露内容
- 实时显示每个人的完成状态：已提交 / 输入中 / 未开始
- 时限到未提交 → 该玩家本轮记为**未提交**，本轮必然不相遇
- **未提交的展示规则**：若超时那一刻输入框里有内容，展示该内容并标注「未提交」；若输入框为空，展示 `[未提交]`

### 4.3 判定与投票

- **全员写出完全相同的词 → 直接判赢**，跳过投票，直接进结算页
- 否则进入投票，固定 5 秒，同时投、同时揭晓，投票期间看不到任何人的选择
- 全票"是" → 相遇；任一人"否"或超时未投（算否）→ 未通过
- 结果以顶部小弹窗提示「全票通过」/「未通过」，然后过渡到结算页或准备阶段
- 不允许重投、不允许辩论

### 4.4 准备（prepare）

- 每轮未相遇后进入，倒计时为**准备时限**（默认 30 秒）
- 全员准备 → 立即进入下一轮，不必等倒计时走完
- 倒计时结束 → 无论是否准备完毕，直接进入下一轮
- 准备期间显示每个人的准备状态

### 4.5 中途崩局投票

- 触发点：轮次结束后，且 `round == ceil(轮次上限 / 2)`
  （上限 4→第 2 轮后、8→第 4、12→第 6、16→第 8、20→第 10）
- 该轮的 prepare 被替换为二选一投票：「下一轮」/「玩崩了」
- 倒计时用**准备时限**
- **达到或超过半数选「玩崩了」→ 进入失败页，本局记录直接丢弃（不写入数据库）**
- 未达半数 → 按正常准备流程进入下一轮（即投票结束即进入下一轮，不再重复准备）

### 4.6 结束路径

| 路径 | 页面 | 是否落库 |
|---|---|---|
| 精确相遇 | 成功 | 是 |
| 投票全票通过 | 成功 | 是 |
| 打到轮次上限仍未相遇 | 失败（"差一点"） | 是 |
| 中途崩局投票通过 | 失败 | **否，丢弃** |

---

## 五、结算页

- **曲线只在这里展示**，对局过程中不出现
- 内容：收敛曲线、完整词路径（每轮每人的词，含未提交标记）、投票记录、第几轮相遇 / 差多少
- 两个出口：
  1. **再来一局** —— 保留房间与全部伙伴，回到等待大厅重新准备；**需所有人同意，限时 2 分钟**，超时或有人拒绝则房间销毁，各自回首页
  2. **退出回首页**

---

## 六、判定细则

**词的格式**

- 长度 2–8 字符，只允许汉字与字母
- 提交前做 NFC 归一 + 全角折半角 + 去首尾空白
- 不做繁简转换、不做同义合并（「灯」与「灯光」是两个词）

**禁重复**

- 本局出现过的词不可再提交（含自己用过的）
- 服务端校验，拒绝时提示"这个词本局用过了"，不消耗本轮提交

**主题模式**（可选，默认关闭）

- 开局锁定一个情境，附禁词表，全程有效
- 提交命中禁词 → 拒收并提示（例："这个情境下'家'太省事了"）
- 主题不可中途更换

| 情境 | 禁词示例 |
|---|---|
| 凌晨三点还醒着 | 夜、睡、醒、失眠、黑 |
| 过年回家 | 家、年、回家、春节 |
| 你妈打来的电话 | 妈、电话、母亲 |
| 地铁早高峰 | 地铁、挤、上班、通勤 |
| 分手那天 | 分手、难过、哭、告别 |

---

## 七、默认名字

沿用 **LocalSend 的中文别名算法**：`${形容词}的${水果}`，如「迷人的橙子」「狡猾的蘑菇」。

- 形容词 38 个、水果 26 个，共 988 种组合（取自 LocalSend `zh_CN` 词表）
- 首次进场由服务端分配，同房间内检测重名，撞名则重掷
- 随时可改，改名后 uid 不变

---

## 八、数据结构

### 8.1 服务端内存（房间）

```ts
type Phase =
  | 'lobby'      // 等待大厅，全员准备即开局
  | 'writing'    // 写词
  | 'voting'     // 5 秒投票
  | 'prepare'    // 回合间准备
  | 'breakVote'  // 中途崩局投票
  | 'result'     // 结算页

interface Player {
  uid: string
  name: string
  seat: number                 // 0..3，决定配色
  connected: boolean
  ready: boolean               // lobby / prepare 阶段
  draft: string                // 输入中的草稿，节流上报
  submittedWord?: string       // 不广播
  vote?: boolean               // 不广播
  forfeited: boolean           // 本轮超时未提交
  rematch?: boolean            // 结算页"再来一局"意向
}

interface RoundRecord {
  n: number
  words: Record<string, string>    // uid -> 词（超时者的 draft 或 '未提交'）
  forfeited: string[]              // uid 列表
  votes?: Record<string, boolean>
  outcome: 'exact' | 'voted' | 'miss'
}

interface Room {
  code: string
  mode: 'free' | 'theme'
  themeId?: string
  maxRounds: number          // 4/8/12/16/20
  writeSeconds: number       // 15/30/45/60
  prepareSeconds: number     // 15/30/45/60
  voteSeconds: 5             // 固定
  phase: Phase
  round: number
  phaseDeadline?: number
  hostUid: string
  players: Player[]
  history: RoundRecord[]
  dropped: boolean           // 崩局丢弃标记，true 则不落库
  createdAt: number
  lastActiveAt: number
}
```

### 8.2 SQLite

```sql
CREATE TABLE players (
  uid        TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen  INTEGER NOT NULL
);

CREATE TABLE name_history (
  uid        TEXT NOT NULL,
  name       TEXT NOT NULL,
  changed_at INTEGER NOT NULL
);

CREATE TABLE matches (
  id              TEXT PRIMARY KEY,
  room_code       TEXT NOT NULL,
  mode            TEXT NOT NULL,          -- free | theme
  theme_id        TEXT,
  max_rounds      INTEGER NOT NULL,
  total_rounds    INTEGER NOT NULL,
  converged_round INTEGER,                -- NULL = 未相遇
  outcome         TEXT NOT NULL,          -- exact | voted | none
  started_at      INTEGER NOT NULL,
  ended_at        INTEGER NOT NULL
);

CREATE TABLE match_players (
  match_id      TEXT NOT NULL,
  uid           TEXT NOT NULL,
  seat          INTEGER NOT NULL,
  name_at_time  TEXT NOT NULL,            -- 快照，改名不改历史
  PRIMARY KEY (match_id, uid)
);

CREATE TABLE match_rounds (
  match_id   TEXT NOT NULL,
  n          INTEGER NOT NULL,
  words_json TEXT NOT NULL,
  votes_json TEXT,
  outcome    TEXT NOT NULL,
  PRIMARY KEY (match_id, n)
);

CREATE INDEX idx_mp_uid     ON match_players(uid);
CREATE INDEX idx_match_time ON matches(started_at DESC);
```

**两条硬边界**

1. 房间状态只在内存，5 分钟无活动即销毁，永不落库
2. 只有走完结算页的对局才写入数据库；崩局丢弃的对局一个字都不留

---

## 九、协议

**客户端 → 服务端**

| 消息 | 载荷 | 说明 |
|---|---|---|
| `hello` | `{ uid?, roomCode? }` | 握手，恢复身份与席位 |
| `createRoom` | `{ mode, themeId?, maxRounds, writeSeconds, prepareSeconds }` | |
| `joinRoom` | `{ code }` | |
| `updateSettings` | 同 `createRoom` 的字段 | 仅房主，仅 lobby |
| `rename` | `{ name }` | 1–12 字 |
| `setReady` | `{ ready: boolean }` | 8 秒内可取消 |
| `draft` | `{ text }` | 输入节流，300ms 一次，仅本人 |
| `submitWord` | `{ word }` | |
| `submitVote` | `{ agree: boolean }` | |
| `submitBreakVote` | `{ quit: boolean }` | 崩局投票 |
| `rematch` | `{ accept: boolean }` | 结算页再来一局 |
| `leave` | `{}` | |

**服务端 → 客户端**

| 消息 | 说明 |
|---|---|
| `state` | 全量快照，状态每变一次广播一次 |
| `error` | `{ code, message }` |
| `toast` | 「某某改名了」「某某掉线了」 |

- 快照对他人隐藏 `submittedWord`、`vote`、`draft`，只暴露布尔：已提交 / 已投票 / 正在输入
- 限流：每 uid 每 500ms 最多一条写操作；`draft` 单独限到 300ms
- 心跳：30 秒 ping，60 秒无 pong 判离线；90 秒内可用原 uid 重连恢复席位
- 房主掉线，房主权限移交给最早加入且在线的人

---

## 十、前端

- 原生 JS + 手写 SVG，无框架、无运行时依赖
- 页面：`/`（入口）、`/?r=CODE`（直达房间）、`/archive`（我的档案）
- 渲染：`renderState(state)` 纯函数，历史轮只追加不改，当前轮区域整体重建

### 10.1 视觉系统

| 用途 | 值 |
|---|---|
| 页面底色 | `#FCFCFA` |
| 卡片 | `#FFFFFF` |
| 描边 | `#E8E6E1` |
| 墨色 | `#16161A` |
| 次要文字 | `#8A8781` |
| 玩家 A | `#3D5AFE` 靛蓝 |
| 玩家 B | `#FF5A46` 珊瑚 |
| 玩家 C | `#00A878` 绿 |
| 玩家 D | `#B07CFF` 紫 |

- 字体：`system-ui, "PingFang SC", "Source Han Sans SC", sans-serif`
- 标题 28px/600，正文 16px/400，词卡 36px/500，辅助 13px
- 圆角 14px，边框 1px，阴影 `0 1px 2px rgba(0,0,0,.04)`，无渐变、无光斑、无 emoji
- 动效 `cubic-bezier(.2,.8,.2,1)`，160–220ms：
  1. 揭晓：各人的词从两侧滑入合拢
  2. 历史轮：缩小下沉，堆成一条"路"
  3. 投票按钮：按下沉 1px，选中填色
  4. 相遇：两个字距收紧、合并成一个圆点，一次性短促动效，无烟花

---

## 十一、相似度与曲线

只用于结算页，因此**结算时批量计算一次**，不进对局循环。

```ts
similarity(a: string, b: string): number | null   // 0..1，null = 无法计算
```

三层实现，从简到精：

1. **词簇表**（默认，零依赖）：手工维护 300–500 组语义域。同簇 `0.9` / 相邻簇 `0.5` / 不同簇 `0.2` / 未收录 `null`
2. **词向量**（可选，服务端）：裁剪后的中文词向量（10 万词，约 40MB 内存）
3. **兜底**：`null` 在图上画虚线

曲线渲染：横轴轮次，纵轴相似度，每轮两个点各按玩家配色，收缩到一点即相遇；手写 SVG，可导出下载。

> 词向量在服务端加载计算，前端只收坐标，首屏不加任何体积。

---

## 十二、身份

- **uid**：`crypto.randomUUID()`，存 `localStorage['synconym.uid']` + cookie `sy_uid`（30 天）
- **首访**：服务端分配 LocalSend 风格名字并写入 `players`
- **改名**：只改 `players.name` 并追加 `name_history`；uid 不变，档案连续；全场实时广播
- **邀请链接**：`/?r=CODE&inviter=UID`，接收方记录 `inviterUid`，档案页可显示"和谁玩过"
- **重置**：档案页提供"我是新人"，清空本地身份，服务端另发新 uid
- **隐私**：一句话说明存了 uid、名字、对局记录

---

## 十三、部署

- 单进程：静态文件 + WS 同端口
- 数据：`data/synconym.db`（SQLite / better-sqlite3），挂持久卷
- 环境变量：`PORT`、`PUBLIC_URL`
- 无外部 API 依赖

---

## 十四、里程碑

| 里程碑 | 内容 | 验收标准 |
|---|---|---|
| **M1** | 同屏双人本地版（BroadcastChannel） | 大厅准备开局 → 写词 → 揭晓 → 5 秒投票 → 准备 → 下一轮；精确相遇直接判赢；超时显示 `[未提交]` |
| **M2** | 服务端房间 + WS + 重连 | 两台设备凭房号进房；刷新恢复席位；房主掉线移交 |
| **M3** | 结算页 + 曲线 + 再来一局 | 曲线与词路径正确；再来一局需全员同意，2 分钟超时销毁 |
| **M4** | 崩局投票 + 丢弃逻辑 | 1/2 处出现崩局投票；过半则失败且数据库无记录 |
| **M5** | 主题模式 + 禁词表 | 禁词被拒收并给出理由 |
| **M6** | uid + 档案页 | 改名即时同步；同一 uid 改名仍算同一人 |
| **M7** | 词簇表 + 部署 | 覆盖 500 常用词；重启后对局记录仍在 |

---

## 十五、明确不做

- 陌生人速配池
- 付费、密钥、网盘引流
- 账号注册、密码、手机号
- AI 陪练 / AI 对手
- 大厅游戏合集、排行榜

---

## 十六、风险与对策

| 风险 | 对策 |
|---|---|
| 投票只有 5 秒，可能来不及看清就超时 | 投票开始时做一次视觉强调；超时默认"否"是保守且可接受的 |
| 崩局投票在 2 人局等于一票否决 | 按"≥ 半数"实现，2 人局 1 票即通过，符合字面规则（见待确认项） |
| 准备阶段被当成休息，玩家挂机 | 准备时限本身就是上限，超时强制进下一轮 |
| draft 节流上报增加流量 | 300ms 节流 + 仅在 writing 阶段启用 |
| 词簇覆盖不足导致曲线断点 | 接受虚线，战报注明"未收录词" |

---

## 十七、待确认

1. **2 人局崩局投票**：字面"已有半数"= 1 票即崩，确认是否如此
2. **打到轮次上限未相遇**：我按"记录保留"设计（只有崩局才丢弃），确认
3. **再来一局有人拒绝**：我按"立即销毁房间，各自回首页"设计，确认
4. 崩局投票未过半时，是"投票结束即进下一轮"，还是"再走一次正常准备"——我按前者实现
