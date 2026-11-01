# 近意词 Synconym

> 各自写一个词，同时揭晓，从上一轮的词继续靠近，直到想到同一个东西。

2–4 人实时对局的小游戏：每轮所有人在互不可见的情况下各写一个词，同时揭晓；全员归一化后写出同一个词即算"相遇"，否则交给玩家投票判定。判定交给投票，收敛过程交给结算页曲线，身份交给本地持久化的 uid。

完整设计（流程、判定细则、协议、设计系统）见 [DESIGN.md](DESIGN.md)。

## 当前进度

项目按 [DESIGN.md 第十四节](DESIGN.md#十四里程碑) 的里程碑推进，目前处于 **M1 完成、M2 进行中**：

| 能力 | 状态 |
|---|---|
| 创建房间 / 设置房间参数 | 已完成 |
| 房号加入、邀请链接直达 `/?r=CODE` | 已完成 |
| 等待大厅：准备同步、房主开始、改名、退出、转让房主、空闲倒计时 | 已完成 |
| 断线后（仅大厅）用原 uid 恢复席位 | 已完成 |
| 写词阶段显示倒计时，提交与判定服务端尚未接入 | 未完成 |
| 投票、准备阶段、崩局投票、结算页与曲线、再来一局 | 未开发 |

未标记为"已完成"的条目尚未上线，请勿当作可用功能。

## 技术栈

- **运行时**：Node.js（ESM，`"type": "module"`），无打包器、无框架、无 TypeScript
- **服务端**：`node:http` 静态文件 + `ws` WebSocket，同一进程同一端口
- **持久化**：`better-sqlite3`（`data/synconym.db`）
- **自然语言归一**：`opencc-js`（只加载 t2s，繁转简）
- **图标**：`lucide-static`，构建期抽成 `public/icons.svg` sprite
- **前端**：手写 ES module + CSS，状态由服务端全量快照驱动

## 快速开始

```bash
npm install
npm run dev      # node --watch server/index.js
```

浏览器打开 <http://localhost:3000>。开发时用 `npm run dev`（改代码自动重启），正式启动用 `npm start`。

> **Node 版本**：`better-sqlite3@13` 的原生模块要求 **Node ≥ 22**。`package.json` 里的 `engines` 仍写着 `>=20`，在 Node 20 上加载该模块会直接崩溃（进程退出码 `0xC0000005`）。

首次运行会自动创建 `data/synconym.db`（已在 `.gitignore` 中忽略）。前端首次连接由服务端分配一个 LocalSend 风格的名字（`形容词的＋水果`）和 uid，uid 存在浏览器 `localStorage`，因此刷新后仍是同一身份。

## 可用脚本

| 命令 | 说明 |
|---|---|
| `npm run dev` | 带 `--watch` 启动服务，改动自动重启 |
| `npm start` | 启动服务 |
| `npm test` | 运行 `node --test` 全部测试 |
| `npm run build:icons` | 从 `lucide-static` 重新生成 `public/icons.svg` |

## 环境变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `PORT` | `3000` | HTTP 与 WebSocket 共用端口 |
| `PUBLIC_URL` | 空 | 生成邀请链接时用的对外地址（如 `https://syn.example`） |
| `DB_PATH` | `data/synconym.db` | SQLite 文件路径，`':memory:'` 可跑纯内存实例（测试用） |

## 目录结构

```
synconym/
├── DESIGN.md              # 设计文档（规则、协议、里程碑的唯一来源）
├── package.json
├── public/                # 前端静态资源，由服务端直接托管
│   ├── index.html
│   ├── app.js             # 客户端主逻辑：路由、动作、弹窗
│   ├── render.js          # renderState 纯函数，快照 → DOM
│   ├── ws.js              # 连接、重连、消息队列
│   ├── styles.css         # 设计令牌与组件样式
│   └── icons.svg          # 构建期生成的图标 sprite
├── server/
│   ├── index.js           # 启动：http 静态文件 + /ws 升级
│   ├── rooms.js           # 房间 Map、状态机、定时器、广播
│   ├── rules.js           # 归一化、校验、默认设置
│   ├── names.js           # LocalSend 风格默认名
│   └── db.js              # SQLite 建表与读写
├── scripts/
│   └── build-icons.js     # 从 lucide-static 抽 sprite
└── test/
    ├── rooms.test.js      # 房间状态机单元测试
    └── integration.test.js # WebSocket 集成测试
```

## 规则要点
本节描述的是 [DESIGN.md](DESIGN.md) 已定稿的目标规则；其中投票、崩局投票与结算相关部分尚未实现，当前代码可玩的只到等待大厅与开局倒计时。

**房间设置**（房主在等待大厅可改，开局后锁定）

| 设置项 | 取值 | 默认 |
|---|---|---|
| 轮次上限 | 4–20 任意整数 | 12 |
| 写词时限 | 15 / 30 / 45 / 60 秒 | 45 |
| 准备时限 | 15 / 30 / 45 / 60 秒 | 30 |
| 禁止重复词 | 开 / 关 | 开 |
| 模式 | 自由 / 主题 | 自由 |

投票倒计时固定 5 秒；房间 2–4 人，全员准备后房主才能点开始；房号 4 位，字符集去掉易混的 `0/O/1/I/L`；房间 5 分钟无活动即销毁。

**词与判定**

- 长度 1–12 个字符（归一化后计数），只允许汉字与字母；空格允许但比较时忽略
- 归一化顺序：NFC → 全角转半角 → 繁转简 → 去所有空格 → 转小写 → 去首尾空白；归一化后严格相等才算同一个词，展示永远保留原文
- 前端在输入时就拦掉非法字符与超长内容，服务端在提交时再做最终裁决
- 全员写同一个词直接判赢并跳过投票，否则进入 5 秒同屏投票，全票通过才算相遇
- 轮次上限 ≥ 8 时，每满 5 轮插入一次"崩局投票"，过半选择"玩崩了"则本局失败且不写库

## 测试

```bash
npm test
```

`test/rooms.test.js` 为纯逻辑单测（使用内存数据库），`test/integration.test.js` 通过真实 WebSocket 走一遍建房 → 加入 → 准备 → 开始的流程。

## 部署

单进程即可：静态文件与 WebSocket 同端口，把 `data/` 挂到持久卷，设置 `PORT` 与 `PUBLIC_URL`，反向代理需要转发 Upgrade 头到 `/ws`。无任何外部 API 依赖。

## 工程约定

- 服务端是唯一权威，客户端只渲染全量快照，不做增量
- 所有时间点用毫秒时间戳，倒计时以服务端 `phaseDeadline` 为基准，客户端只做插值
- 归一化、校验与判定集中在 `server/rules.js`，前端只做即时拦截
- 依赖只允许 `ws`、`better-sqlite3`、`opencc-js`、`lucide-static` 四个；图标必须来自 Lucide，不手写 SVG path
- 提交前跑 `npm test`，每个里程碑完成即提交

## 许可

仓库暂未附带开源许可证文件；在添加前请视为保留所有权利。
