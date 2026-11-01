# Synconym 设计方案

> 两个人（或四个人）各自写一个词，同时揭晓，从上一轮的词继续靠近，直到想到同一个东西。
> 判定交给玩家投票，距离交给曲线，身份交给 uid。

状态：**已定稿**（v0.5）

## 变更记录

- **v0.5**：禁词与重复词在提交时全部拦下；超时留下的非法内容统一显示 `[非法答案]`；字符类与长度在前端输入时拦截；待确认项全部确认
- **v0.4**：超时的输入框内容直接当作提交，不再区分"草稿"与"提交"，超时也可以相遇
- **v0.3**：轮次改 4–20 任意值；房主在全员准备后手动开始；break 轮改为 8 轮以上每 5 轮一次；词放宽到 1–12 字并支持盘古空格与繁简归一；重复词禁令改为房间选项；新增 `[重复词]` 超时标记；主题全部换新；图标改用图标库；补齐组件与双向动画规范；移除同屏里程碑
- **v0.2**：投票固定 5 秒同时投；回合间准备阶段；中途崩局投票；曲线移到结算页；设置离散化；默认名改用 LocalSend 风格
- **v0.1**：初版

---

## 一、入口

1. **创建房间** —— 选模式与设置，进等待大厅
2. **按房间号加入** —— 输入 4 位房号
3. **邀请链接直达** —— `/?r=CODE` 打开即进房

---

## 二、房间设置

| 设置项 | 取值 | 默认 | 控件 |
|---|---|---|---|
| 轮次上限 | **4–20 任意整数** | 12 | 步进器 `−  12  +` |
| 写词时限 | 15 / 30 / 45 / 60 秒 | 45 | 分段选择 |
| 准备时限 | 15 / 30 / 45 / 60 秒 | 30 | 分段选择 |
| 禁止重复词 | 开 / 关 | 开 | 开关 |
| 模式 | 自由 / 主题 | 自由 | 分段选择 |

- 投票倒计时固定 5 秒，不设开关
- 房间支持 **2–4 人**，不设"期望人数"，全凭房主何时按开始
- 房主在创建时设定，等待大厅内仍可修改，开局后锁定

---

## 三、等待大厅

- 房号 4 位（字符集去掉 `0/O/1/I/L`），创建即显示，可一键复制邀请链接
- 玩家点「准备」，状态实时同步
- **全员准备后，房主的「开始」按钮才可用**；房主点击才真正开局
- 准备期间可做的事：
  1. 查看房间设置（房主可改，非房主只读）
  2. 查看并复制房号与邀请链接
  3. 改自己的名字
  4. 邀请其他人
  5. 准备 / 取消准备
  6. 退出房间
- 8 秒内可取消准备，防误触

---

## 四、一局的流程

### 4.1 状态机

```
lobby ──全员准备且房主点开始──▶ writing
writing ──全员提交/超时──▶ 判定
                            ├─ 全部写同一个词 ─────────▶ result（成功）
                            └─ 否则 → voting（固定 5s）
                                        ├─ 全票通过 ───▶ result（成功）
                                        └─ 未通过 → 弹窗 → prepare / breakVote
prepare / breakVote ──▶ 下一轮 writing（或 result）
```

### 4.2 写词（writing）

- 所有人同时写，互不可见；输入实时节流上报，用于显示"正在输入"
- 实时显示每人状态：**已提交 / 正在输入 / 未开始**
- **输入阶段由前端先过滤**：非法字符（数字、标点、emoji）根本打不进去；超过 12 字不再接受新字符；粘贴的超长或含非法字符内容自动裁掉
- **提交阶段由服务端拦下所有不合法内容**：重复词、命中禁词一律拒收并说明原因，不消耗本轮，玩家可以继续改
- 倒计时结束时，**输入框里的内容就是答案**，由服务端当作提交处理，走同一套校验，因此超时也可能相遇
- 答案格最终只有三种形态：空 → `[未提交]`；非空但不合法（重复词 / 禁词）→ `[非法答案]`；合法 → 原文
- 不合法内容不参与判定

### 4.3 判定与投票

- **全员写出同一个词（归一化后比较）→ 直接判赢**，跳过投票
- 否则进入投票，固定 5 秒，同屏展示本轮所有词，下方是「是」/「否」
- 同时投、同时揭晓，投票期间看不到任何人的选择
- 全票「是」→ 相遇；任一人「否」或超时（算否）→ 未通过
- 顶部小弹窗提示「全票通过」/「未通过」，然后过渡到结算页或下一阶段

### 4.4 准备（prepare）

- 每轮未相遇后进入，倒计时为准备时限
- 全员准备 → 立即进下一轮；倒计时结束 → 无论准备与否直接进下一轮

### 4.5 崩局投票（breakVote）

- **仅当轮次上限 ≥ 8 时才存在**
- 触发点：**每满 5 轮**且未到终点 —— `round % 5 === 0 && maxRounds >= 8 && round < maxRounds`

  | 轮次上限 | 触发轮 |
  |---|---|
  | 4 / 5 / 6 / 7 | 无 |
  | 8 | 第 5 轮后 |
  | 12 | 第 5、10 轮后 |
  | 16 | 第 5、10、15 轮后 |
  | 20 | 第 5、10、15 轮后 |

- 该轮的准备阶段被替换为二选一：「下一轮」/「玩崩了」，倒计时用准备时限
- **达到或超过半数选「玩崩了」→ 失败页，本局记录直接丢弃**
- 未达半数 → 直接进入下一轮，不再走一遍准备

### 4.6 结束路径

| 路径 | 页面 | 是否落库 |
|---|---|---|
| 精确相遇 | 成功 | 是 |
| 投票全票通过 | 成功 | 是 |
| 打满轮次仍未相遇 | 失败 | 是 |
| 崩局投票通过 | 失败 | **否，丢弃** |

---

## 五、结算页

- **曲线只在这里展示**
- 内容：收敛曲线、完整词路径（原文 + 每格标记 `[未提交]` / `[非法答案]`）、投票记录、第几轮相遇
- 出口：
  1. **再来一局** —— 保留房间与伙伴，回等待大厅；**需所有人同意，限时 2 分钟**，超时或拒绝则销毁房间
  2. **退出回首页**

---

## 六、判定细则

### 6.1 归一化（比较前执行）

```
norm(w):
  1. Unicode NFC
  2. 全角 → 半角
  3. 繁体 → 简体
  4. 移除所有空格（含盘古空格）
  5. 字母转小写
  6. 去首尾空白
```

两个词 `norm` 后严格相等才算"同一个词"。展示时永远保留玩家原文。

- **盘古空格**：`iOS 手机` 与 `iOS手机`、`New York` 与 `NewYork` 视为同一个词
- **繁简**：`憂鬱` 与 `忧郁`、`臺灣` 与 `台湾` 视为同一个词
- 实现：服务端用 `opencc-js`（t2s）做繁简转换，其余为正则

### 6.2 词的约束

- 长度 **1–12 个字符**（按归一化后计数）
- 只允许汉字与字母，不允许数字、标点、emoji
- 空格允许，但比较时忽略
- **长度与字符类在前端输入时就拦死**：打不进去、粘不进来，超出部分直接裁掉

### 6.3 禁止重复词（房间选项，默认开）

- 开启时：本局出现过的词不可再次提交（含自己用过的）
- 服务端在提交时拦截并提示「这个词本局用过了」，不消耗本轮，可继续改
- 关闭时：允许任意重复

### 6.4 主题模式（可选，默认关闭）

开局锁定一个情境，附禁词表，全程有效；命中禁词拒收并说明理由；不可中途更换。

| 情境 | 禁词 |
|---|---|
| 周五晚上 | 周末、放松、开心、下班 |
| 便利店 | 便利店、买、零食、关东煮 |
| 外卖到了 | 外卖、饭、骑手、饿 |
| 期末周 | 考试、复习、挂科、图书馆 |
| 演唱会 | 演唱会、歌、尖叫、荧光棒 |
| 游戏开黑 | 游戏、队友、开黑、上分 |
| 健身房 | 健身、运动、器械、汗 |
| 猫咖 | 猫、咖啡、撸、毛 |
| 拆快递 | 快递、包裹、买、箱 |
| 刚睡醒 | 睡、醒、闹钟、床 |
| 搬家 | 搬、家、箱子、行李 |
| 抢票 | 票、抢、排队、秒杀 |

---

## 七、默认名字

沿用 **LocalSend 的中文别名算法**：`${形容词}的${水果}`，如「迷人的橙子」「狡猾的蘑菇」。

- 取自 LocalSend `zh_CN` 词表：38 个形容词 × 26 种水果 = 988 种组合
- 首次进场由服务端分配，同房间内重名则重掷
- 随时可改，改名后 uid 不变

---

## 八、数据结构

### 8.1 服务端内存（房间）

```ts
type Phase =
  | 'lobby' | 'writing' | 'voting' | 'prepare' | 'breakVote' | 'result'

interface Player {
  uid: string
  name: string
  seat: number                 // 0..3，决定配色
  connected: boolean
  ready: boolean
  draft: string                // 输入框内容，超时即作为提交
  submittedWord?: string       // 不广播
  vote?: boolean               // 不广播
  breakVote?: boolean          // 不广播
  rematch?: boolean
}

interface RoundRecord {
  n: number
  words: Record<string, string>    // 展示用原文
  marks: Record<string, 'none' | 'empty' | 'invalid'>
  outcome: 'exact' | 'voted' | 'miss'
}

interface Room {
  code: string
  mode: 'free' | 'theme'
  themeId?: string
  maxRounds: number          // 4..20
  writeSeconds: 15 | 30 | 45 | 60
  prepareSeconds: 15 | 30 | 45 | 60
  banRepeat: boolean
  phase: Phase
  round: number
  phaseDeadline?: number
  hostUid: string
  players: Player[]
  history: RoundRecord[]
  dropped: boolean
  createdAt: number
  lastActiveAt: number
}
```

### 8.2 SQLite

```sql
CREATE TABLE players (
  uid TEXT PRIMARY KEY, name TEXT NOT NULL,
  created_at INTEGER NOT NULL, last_seen INTEGER NOT NULL
);

CREATE TABLE name_history (
  uid TEXT NOT NULL, name TEXT NOT NULL, changed_at INTEGER NOT NULL
);

CREATE TABLE matches (
  id TEXT PRIMARY KEY, room_code TEXT NOT NULL,
  mode TEXT NOT NULL, theme_id TEXT,
  max_rounds INTEGER NOT NULL, total_rounds INTEGER NOT NULL,
  converged_round INTEGER,
  outcome TEXT NOT NULL,              -- exact | voted | none
  started_at INTEGER NOT NULL, ended_at INTEGER NOT NULL
);

CREATE TABLE match_players (
  match_id TEXT NOT NULL, uid TEXT NOT NULL, seat INTEGER NOT NULL,
  name_at_time TEXT NOT NULL, PRIMARY KEY (match_id, uid)
);

CREATE TABLE match_rounds (
  match_id TEXT NOT NULL, n INTEGER NOT NULL,
  words_json TEXT NOT NULL, marks_json TEXT NOT NULL,
  votes_json TEXT, outcome TEXT NOT NULL,
  PRIMARY KEY (match_id, n)
);

CREATE INDEX idx_mp_uid     ON match_players(uid);
CREATE INDEX idx_match_time ON matches(started_at DESC);
```

**两条硬边界**

1. 房间状态只在内存，5 分钟无活动即销毁，永不落库
2. 只有走完结算页的对局才入库；崩局丢弃的对局一个字不留

---

## 九、协议

**客户端 → 服务端**

| 消息 | 载荷 | 说明 |
|---|---|---|
| `hello` | `{ uid?, roomCode? }` | 握手，恢复身份与席位 |
| `createRoom` | `{ mode, themeId?, maxRounds, writeSeconds, prepareSeconds, banRepeat }` | |
| `joinRoom` | `{ code }` | |
| `updateSettings` | 同上字段 | 仅房主，仅 lobby |
| `rename` | `{ name }` | 1–12 字 |
| `setReady` | `{ ready }` | 8 秒内可取消 |
| `start` | `{}` | 仅房主，需全员准备 |
| `draft` | `{ text }` | 300ms 节流；超时即以此内容作为提交 |
| `submitWord` | `{ word }` | |
| `submitVote` | `{ agree }` | |
| `submitBreakVote` | `{ quit }` | |
| `rematch` | `{ accept }` | |
| `leave` | `{}` | |

**服务端 → 客户端**：`state`（全量快照）、`error`、`toast`

- 快照对他人隐藏 `submittedWord` / `vote` / `breakVote` / `draft`，只暴露布尔状态
- 限流：每 uid 每 500ms 一条写操作；`draft` 单独 300ms
- 心跳 30 秒，90 秒内可用原 uid 重连恢复席位
- 房主掉线，权限移交最早加入且在线者

---

## 十、前端与设计系统

原生 JS，无框架。**但图标一律用图标库，不手写 SVG 路径。**

### 10.1 依赖

| 用途 | 方案 |
|---|---|
| 图标 | **Lucide**（`lucide-static`），构建期抽成一张本地 sprite，运行时不请求 CDN |
| 繁简 | 服务端 `opencc-js` |
| 曲线 | 手写 SVG（数据图形，非图标） |

需要的图标：`plus` `minus` `check` `x` `copy` `settings` `user` `log-out` `clock` `play` `users` `chevron-down` `rotate-ccw`

### 10.2 设计令牌

```
--dur-1: 120ms   --dur-2: 180ms   --dur-3: 240ms   --dur-4: 320ms
--ease-out: cubic-bezier(.2,.8,.2,1)
--ease-in-out: cubic-bezier(.4,0,.2,1)
--ease-spring: cubic-bezier(.34,1.56,.64,1)
```

色彩：

| 用途 | 值 |
|---|---|
| 底 | `#FCFCFA` |
| 卡 | `#FFFFFF` |
| 描边 | `#E8E6E1` |
| 墨 | `#16161A` |
| 次 | `#8A8781` |
| A | `#3D5AFE` |
| B | `#FF5A46` |
| C | `#00A878` |
| D | `#B07CFF` |

字体 `system-ui, "PingFang SC", "Source Han Sans SC", sans-serif`；标题 28/600，正文 16/400，词卡 36/500，辅助 13/400。圆角 14px，边框 1px，阴影 `0 1px 2px rgba(0,0,0,.04)`。

### 10.3 组件与双向动画（强制清单）

每个组件必须有 default / hover / active / focus-visible / disabled 五态，且**进出都带动画**，用 `transition` 而非 keyframes（可中断、不卡顿）。

| 组件 | 动效要求 |
|---|---|
| **按钮** | hover 背景色过渡 120ms；active `translateY(1px) scale(.99)`；focus-visible 2px 偏移描边环；disabled 降到 40% 不透明并禁用指针；加载态图标旋转 |
| **开关（switch）** | 轨道 44×24 变色 + 滑块 20px 位移，180ms `ease-out`，双向 |
| **步进器** | `−` / `+` 按压反馈；数字变化时旧值上滑淡出、新值下滑淡入 180ms |
| **分段选择** | 选中背景块用 FLIP 平滑移到新位置，240ms |
| **下拉选择** | 展开用 `max-height + opacity + translateY(-4px)` 240ms；选项 hover 背景 120ms；收起反向播放 |
| **滚动条** | 自定义 6px 圆角，hover 变宽到 8px 且加深颜色，180ms；Firefox 走 `scrollbar-width: thin` |
| **Toast** | 顶部滑入 180ms，2.5s 后滑出 |
| **页面切换** | View Transitions API，降级为淡入 + 上移 8px，240ms |
| **列表增删** | FLIP + enter/exit 过渡，不出现瞬间跳变 |
| **词卡揭晓** | 各玩家的词从两侧滑入合拢，240ms `ease-out` |
| **相遇瞬间** | 两个字距收紧合并为一个圆点，圆点脉冲一次，320ms，无烟花无 emoji |

### 10.4 排版

- 单栏，最大宽度 640px，垂直节奏 8px 网格
- 页面标题 + 一行说明，不堆叠副标题
- 不加状态灯、不加装饰性二级描述，让控件自己表达
- 全站零 emoji，图形一律来自 Lucide

---

## 十一、相似度与曲线

只用于结算页，**结算时批量计算一次**。

```ts
similarity(a: string, b: string): number | null   // 0..1，null = 无法计算
```

1. **词簇表**（默认，零依赖）：手工维护 300–500 组语义域；同簇 0.9 / 邻簇 0.5 / 异簇 0.2 / 未收录 `null`
2. **词向量**（可选，服务端）：裁剪中文词向量，约 40MB 内存
3. 未收录画虚线

曲线：横轴轮次，纵轴相似度，每轮两点按玩家配色，收到一点即相遇；手写 SVG，可导出。

---

## 十二、身份

- **uid**：`crypto.randomUUID()`，存 `localStorage` + cookie `sy_uid`（30 天）
- **首访**：服务端分配 LocalSend 风格名字，写入 `players`
- **改名**：改 `players.name` 并追加 `name_history`；uid 不变，档案连续
- **邀请链接**：`/?r=CODE&inviter=UID`，接收方记录 inviter
- **重置**：档案页「我是新人」，清空本地身份
- **隐私**：一句话说明存了 uid、名字、对局记录

---

## 十三、部署

单进程：静态文件 + WS 同端口；`data/synconym.db`（better-sqlite3）挂持久卷；环境变量 `PORT`、`PUBLIC_URL`；无外部 API 依赖。

---

## 十四、里程碑

| 里程碑 | 内容 | 验收标准 |
|---|---|---|
| **M1** | 服务端骨架 + 大厅 | 建房/加入/改名/准备；房主在全员准备后点开始才开局；刷新恢复席位 |
| **M2** | 主循环 | 写词 → 判定 → 5 秒投票 → 准备 → 下一轮；精确相遇直接结算；超时取输入框内容作提交（可相遇），空/重复/禁词按标记显示 |
| **M3** | 结算页 + 曲线 | 曲线、词路径、标记、投票记录正确；再来一局需全员同意，2 分钟超时销毁 |
| **M4** | 崩局投票 | 仅 ≥8 轮存在；每 5 轮触发一次；过半则失败且数据库无记录 |
| **M5** | 主题模式 | 12 个情境与禁词生效，拒收有理由 |
| **M6** | uid + 档案页 | 改名即时同步；同一 uid 改名仍算同一人 |
| **M7** | 词簇表 + 部署 | 覆盖 500 常用词；重启后记录仍在 |

M1、M2 同期完成设计系统（令牌、组件、动画），不留到后面补。

---

## 十五、明确不做

- 陌生人速配池
- 付费、密钥、网盘引流
- 账号注册、密码、手机号
- AI 陪练 / AI 对手
- 大厅游戏合集、排行榜
- 手写 SVG 图标

---

## 十六、风险与对策

| 风险 | 对策 |
|---|---|
| 5 秒投票可能来不及看清 | 投票开始时做一次视觉强调；超时算否是保守且可接受的 |
| 崩局投票在 2 人局等于一票否决 | 按 ≥ 半数实现，2 人局 1 票即通过（已定） |
| 繁简归一化改变"精确"含义 | 归一化只影响比较，展示永远保留原文 |
| opencc-js 增加服务端体积 | 只加载 t2s 单表，约 1MB |
| 动画过多影响低端机 | 统一走 `prefers-reduced-motion` 降级 |
| 最后一次 draft 因网络抖动没送达 | 倒计时结束前 500ms 客户端强制上报一次；服务端取最后一次成功收到的内容 |

---

## 十七、已确认的决定

以下为 v0.5 定稿时确认的规则，不再列为待议：

1. **2 人局崩局投票**：≥ 半数即通过，2 人局 1 票即崩
2. **打满轮次未相遇**：记录保留，只有崩局才丢弃
3. **再来一局有人拒绝**：立即销毁房间，各自回首页
4. **崩局投票未过半**：直接进下一轮，不再走准备
5. **字母大小写**：`iOS` 与 `ios` 归一为同一词
