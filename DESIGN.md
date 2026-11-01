# Synconym 设计方案

> 两个人（或四个人）各自写一个词，同时揭晓，从上一轮的词继续靠近，直到想到同一个东西。
> 判定交给玩家投票，距离交给曲线，身份交给 uid。

状态：**待审阅**（v0.1）

---

## 一、玩法

### 1.1 一局的生命周期

1. 房主创建房间，得到 4 位房号（如 `7K2M`，字符集去掉 `0/O/1/I/L`）
2. 房主设置：模式（自由 / 主题）、人数（2 / 3 / 4）、每轮写词时限（不限 / 30s / 60s / 90s）
3. 其他人凭房号或邀请链接加入，房主开始
4. **第 1 轮**：各自独立写一个词，互相不可见；全员提交后**同时揭晓**
5. **投票**：揭晓后进入投票，"我们说的是不是同一个东西"，同时投、同时揭晓
6. 未相遇 → **第 2 轮**：看着上一轮所有人的词，各写一个"能搭桥"的词
7. 重复 4–6，直到相遇或触及轮次上限
8. 结束 → 战报（收敛曲线、完整词路径、投票记录、第几轮相遇）

### 1.2 判定规则（无歧义版本）

**三条相遇路径，优先级从上到下：**

| 路径 | 条件 | 战报标注 |
|---|---|---|
| 精确相遇 | 全员同轮写出完全相同的词 | 完全相遇 |
| 投票相遇 | 全员投票"是"，全票通过 | 投票相遇 |
| 未相遇 | 达到轮次上限仍未通过 | 差一点 |

**词的格式约束**

- 长度 2–8 个字符
- 只允许汉字与字母（不含空格、数字、标点、emoji）
- 提交前做 Unicode NFC 归一 + 全角折半角 + 去首尾空白
- 不做繁简转换、不做同义合并（「灯」与「灯光」是两个词）

**禁重复**

- 本局出现过的词不可再次提交（含自己用过的）
- 服务端校验，拒绝时返回"这个词本局用过了"，不消耗本轮提交

**投票**

- 触发：每一轮揭晓后自动进入，未相遇的轮次都要投
- 形式：二元选择，**同时投、同时揭晓**，投票期间看不到任何人的选择
- 全员"是" → 相遇；任一"否" → 直接进入下一轮
- **不允许重投、不允许辩论**（否则会僵住）
- 超时未投 → 视为"否"
- 投票默认 20 秒倒计时

**轮次上限**

- 默认 12 轮。触及上限时强制投一次票，仍未通过则以"未相遇"结束，战报记录最好相似度

### 1.3 两种模式

**自由模式**（默认）：无主题、无禁词，纯即兴起手。

**主题模式**：开局锁定一个情境，附禁词表，全程有效。

- 第 1 轮即在该情境下起手
- 提交命中禁词 → 拒收并提示（例："这个情境下'家'太省事了"）
- 主题不可中途更换

主题示例（各含 6–10 个禁词）：

| 情境 | 禁词示例 |
|---|---|
| 凌晨三点还醒着 | 夜、睡、醒、失眠、黑 |
| 过年回家 | 家、年、回家、春节 |
| 你妈打来的电话 | 妈、电话、母亲 |
| 地铁早高峰 | 地铁、挤、上班、通勤 |
| 分手那天 | 分手、难过、哭、告别 |

### 1.4 玩家边界

- 无需注册，进来即有人格（自动分配名字）
- 名字随时可改，全场实时同步
- 掉线凭 uid + 房号可重连恢复席位
- 房主掉线，房主权限移交给最早加入且在线的人

---

## 二、时序与状态机

**房间状态**：`waiting` → `playing` → `finished`（旁路 `abandoned`）

**轮内子状态**：

```
writing ──全员提交──▶ reveal ──▶ voting ──全员投完──▶ voted ──┬─ 相遇 ─▶ finished
   ▲                                                          └─ 未遇 ─▶ writing(下一轮)
```

- 服务端是唯一权威：所有状态在服务端，广播全量快照，前端只负责渲染
- `writing` 期提交只广播"某人已提交"，不泄露内容
- `voting` 期只广播"某人已投票"，不泄露选择
- 写词超时未提交 → 本轮弃权，记为 `…`，本轮必然不相遇
- 房间 5 分钟无活动 → 标记 `abandoned`，从内存移除（对局不落库）

---

## 三、数据结构

### 3.1 服务端内存（房间）

```ts
type Phase = 'writing' | 'reveal' | 'voting' | 'voted' | 'done'

interface Player {
  uid: string
  name: string
  seat: number            // 0..3，决定配色
  connected: boolean
  submittedWord?: string  // writing 期存在，但不广播
  vote?: boolean          // voting 期存在，但不广播
  forfeited: boolean      // 本轮弃权
}

interface RoundRecord {
  n: number
  words: Record<string, string>     // uid -> 词
  votes?: Record<string, boolean>   // uid -> 是否认为同一个东西
  outcome: 'exact' | 'voted' | 'miss' | 'forfeit'
}

interface Room {
  code: string
  mode: 'free' | 'theme'
  themeId?: string
  maxRounds: number              // 默认 12
  roundSeconds: number           // 0 = 不限时
  state: 'waiting' | 'playing' | 'finished'
  phase: Phase
  round: number
  phaseDeadline?: number         // 毫秒时间戳
  hostUid: string
  players: Player[]
  history: RoundRecord[]
  createdAt: number
  lastActiveAt: number
}
```

### 3.2 SQLite

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

**只有结算后的对局写入数据库，房间状态永不落库。** 这是一条硬边界：房间生命周期 5 分钟，对局记录只追加。

**常用查询**

- 我和某人玩过几次：`matches` join 两个 `match_players`
- 最好成绩：`SELECT MIN(converged_round) FROM matches WHERE id IN (...)`
- 最常一起撞上的词：`match_rounds` 里 `outcome='exact'` 的词聚合

---

## 四、服务端

- Node 20+，`ws` 原生 WebSocket（不用 socket.io，省依赖和体积）
- 单进程，房间存在内存 `Map<code, Room>`，定时器每 30 秒清理过期房间
- 协议：JSON 文本帧

**客户端 → 服务端**

| 消息 | 载荷 | 说明 |
|---|---|---|
| `hello` | `{ uid?, roomCode? }` | 握手，带 uid 则恢复身份，带房号则恢复席位 |
| `createRoom` | `{ mode, themeId?, roundSeconds, maxRounds? }` | |
| `joinRoom` | `{ code }` | |
| `rename` | `{ name }` | 1–12 字，实时广播 |
| `start` | `{}` | 仅房主 |
| `submitWord` | `{ word }` | 校验格式、禁词、禁重复 |
| `submitVote` | `{ agree: boolean }` | |
| `leave` | `{}` | |

**服务端 → 客户端**

| 消息 | 说明 |
|---|---|
| `state` | **全量快照**（每轮数据极小，全量最省心，避免 diff bug） |
| `error` | `{ code, message }`，前端 toast |
| `toast` | 系统提示（某某改名、某某掉线） |

- 限流：每 uid 每 500ms 最多一条写操作
- 心跳：30 秒 ping，60 秒无 pong 判离线；离线后 90 秒内容许原 uid 重连恢复席位
- 全量快照里对他人**隐藏** `submittedWord` 与 `vote`（仅暴露布尔"已提交/已投票"）

---

## 五、前端

- 原生 JS + 手写 SVG，无框架、无运行时依赖
- 页面：`/`（入口：创建 / 加入）、`/?r=CODE`（直接进房）、`/archive`（我的档案）
- 渲染策略：一个 `renderState(state)` 纯函数；历史轮只追加不改，当前轮区域整体重建（数据量小，无性能问题）

### 5.1 视觉系统

**色彩**

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

**字体**：`system-ui, "PingFang SC", "Source Han Sans SC", sans-serif`
标题 28px / 600，正文 16px / 400，词卡 36px / 500，辅助 13px

**形状**：圆角 14px，边框 1px，阴影 `0 1px 2px rgba(0,0,0,.04)`，无渐变、无光斑、无 emoji

**动效**（`cubic-bezier(.2,.8,.2,1)`，160–220ms）

1. 揭晓：两张词卡从左右滑入，在中央合拢
2. 历史轮：每轮结束时缩小并下沉，堆成一条"路"
3. 投票按钮：按下时下沉 1px，选中后填色
4. 相遇瞬间：两个词中间的字距收紧、合并成一个圆点，一次性短促动效，无烟花

---

## 六、相似度与曲线

### 6.1 接口

```ts
similarity(a: string, b: string): number | null   // 0..1，null = 无法计算
```

### 6.2 三层实现（从简到精，可替换）

1. **词簇表**（默认，零依赖）：`clusters.json` 手工维护 300–500 组语义域。
   相似度 = 同簇 `0.9` / 相邻簇 `0.5` / 不同簇 `0.2` / 未收录 `null`
2. **词向量**（可选，服务端）：裁剪后的中文词向量（10 万词，约 40MB 内存），余弦相似度
3. **兜底**：未命中返回 `null`，曲线上该段用虚线

> 词向量在服务端加载并计算，前端只接收坐标。首屏不增加任何体积。

### 6.3 曲线渲染（手写 SVG）

- 横轴：轮次 `1..n`；纵轴：相似度 `0..1`
- 每轮两个点（各按玩家配色），两点连线表示"此刻的距离"
- 曲线在**每次揭晓后立即更新**，实时可见
- 相遇轮：两点合并为一个较大圆点
- 高度 200px，宽度自适应，`viewBox` 缩放
- 战报页可导出 SVG 下载

---

## 七、身份系统

- **uid**：`crypto.randomUUID()`，写 `localStorage['synconym.uid']` 与 cookie `sy_uid`（30 天），优先读 localStorage
- **首访**：服务端从词组池分配随机名字（如「橘子-2」「第七位乘客」），写入 `players`
- **改名**：更新 `players.name` 并追加 `name_history`，全场实时广播；uid 不变，因此档案仍然连续
- **邀请链接**：`/?r=CODE&inviter=UID`，接收方把 `inviterUid` 记入本地 `knownPlayers`，档案页可显示"和谁玩过"
- **重置**：档案页提供"我是新人"，清 localStorage 与 cookie，服务端另发新 uid
- **隐私说明**：一句话写清存了 uid、名字、对局记录，不收集其它信息

---

## 八、部署

- 单进程：静态文件 + WS 同端口
- 数据：`data/synconym.db`（SQLite，better-sqlite3），挂载持久卷
- 环境变量：`PORT`、`PUBLIC_URL`
- 无外部 API 依赖；词向量若启用，也只是本地文件
- 备份：db 文件定时复制

---

## 九、里程碑与验收

| 里程碑 | 内容 | 验收标准 |
|---|---|---|
| **M1** | 同屏双人本地版（BroadcastChannel 同步两个窗口） | 两人写完 → 同时揭晓 → 投票 → 未通过进下一轮；能撞上；曲线随轮次更新 |
| **M2** | 服务端房间 + WS + 重连 | 两台设备凭房号进同一房；刷新恢复席位；房主掉线能移交 |
| **M3** | 战报页 + 曲线导出 SVG | 战报含曲线、词路径、投票记录，可下载 |
| **M4** | 主题模式 + 禁词表 | 禁词被拒收且给出理由；自由模式不受影响 |
| **M5** | uid 体系 + 档案页 | 改名后对方即时看到；同一 uid 改名仍算同一人；档案显示历史对局 |
| **M6** | 词簇表 + 曲线质量打磨 | 覆盖常见 500 词，未收录词显示虚线 |
| **M7** | 部署 | 单机可跑，`PUBLIC_URL` 正确，重启后对局记录仍在 |

---

## 十、明确不做

- 陌生人速配池（冷启动必死）
- 付费、密钥、网盘引流
- 账号注册、密码、手机号
- AI 陪练 / AI 对手
- 大厅、游戏合集、排行榜

---

## 十一、已知风险与对策

| 风险 | 对策 |
|---|---|
| 3–4 人局投票僵持 | 不重投、不允许辩论、超时默认否 |
| 词簇覆盖不足导致曲线断点 | 接受虚线，并在战报注明"未收录词" |
| 词向量占 40MB 内存 | 默认关闭，按需加载 |
| WS 抖动导致误判掉线 | 30s 心跳 + 90s 重连窗口 |
| 全量快照广播的数据量 | 一轮数据 < 1KB，12 轮全量仍 < 20KB，无需优化 |

---

## 十二、待确认的默认值

1. 轮次上限 **12 轮**
2. 写词时限默认 **60 秒**
3. 投票倒计时 **20 秒**
4. 名字风格：中文词组 + 数字后缀（「橘子-2」）
5. 首屏默认进入**自由模式**，主题需主动选
