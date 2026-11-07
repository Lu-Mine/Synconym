# deploy/ 资产说明

这个目录里混了三类东西，适用环境完全不同。**先看这张表再动手**，否则很容易把作者的实例配置当成通用要求。

| 你的部署方式 | 用哪些文件 | 别管哪些 |
|---|---|---|
| **Docker（最省事）** | 仓库根的 `Dockerfile` + `.dockerignore` | 整个 `deploy/` |
| **裸机 + systemd** | [`synconym.service`](synconym.service) | `bt-*`、`github-deploy.sh` |
| **Nginx 反代** | [`nginx.synconym.conf`](nginx.synconym.conf) 或 [`nginx.synconym-split.conf`](nginx.synconym-split.conf) | `bt-*`、`apache.*` |
| **Caddy 反代** | [`Caddyfile.example`](Caddyfile.example) | `bt-*`、`nginx.*` |
| **Apache 反代** | [`apache.synconym.conf`](apache.synconym.conf) | `bt-*`、`nginx.*` |
| **aaPanel（宝塔）** | 全部，含 `bt-start.sh`、`bt-restart.py` | — |

## 真正通用的文件

| 文件 | 作用 | 前提 |
|---|---|---|
| [`prepare-frontend.py`](prepare-frontend.py) | 把 `public/` 打成不可变、自包含的前端快照 | 参数全部由命令行传入，无硬编码路径 |
| [`synconym.service`](synconym.service) | 裸机 systemd 单元 | systemd；`DB_PATH` 按需改 |
| [`nginx.synconym.conf`](nginx.synconym.conf) | Nginx 单端口反代到 `127.0.0.1:3000` | Nginx；需转发 `/ws` 的 Upgrade 头 |
| [`nginx.synconym-split.conf`](nginx.synconym-split.conf) | Nginx 前后端分离（静态直出 + 反代） | 同上 |
| [`apache.synconym.conf`](apache.synconym.conf) | Apache 独立 `:3000` 入口 | `proxy` `proxy_http` `proxy_wstunnel` `headers` |
| [`Caddyfile.example`](Caddyfile.example) | Caddy 反代示例，自动 HTTPS | Caddy |

上面这些里，`DocumentRoot` / `Alias` 仍写着 `/opt/synconym-deploy/...`，那是作者的目录布局，**请换成你自己的路径**——配置本身没有绑死。

## 与 aaPanel 绑定的文件

| 文件 | 绑定到什么 | 换主机怎么办 |
|---|---|---|
| [`bt-start.sh`](bt-start.sh) | 宝塔「Node 项目」的启动命令 | 改文件顶部的 `SYNCONYM_PUBLIC_URL` / `SYNCONYM_APP_DIR` / `SYNCONYM_NODE_BIN` / `SYNCONYM_DB_PATH`；或用 `synconym.service` 代替 |
| [`bt-restart.py`](bt-restart.py) | `import aaPanel` 自己的 `projectModel.nodejsModel` | **非宝塔环境无法运行**，也不需要它，用 systemd 重启 |
| [`github-deploy.sh`](github-deploy.sh) | `panel stop/start` 调 `bt-restart.py`；默认路径是宝塔布局 | 见下节 |
| [`MIGRATION.md`](MIGRATION.md) | 作者把实例迁到 Apache + 宝塔的完整过程 | 当「一个真实案例」读，不要照抄路径 |

## `github-deploy.sh` 的可配置项

它通过 SSH forced command 被调用，**不会继承你的 shell 环境变量**，所以要在服务器上的那份副本里改默认值（文件里已参数化，不用改逻辑）：

| 变量 | 默认 | 用途 |
|---|---|---|
| `SYNCONYM_DEPLOY_BASE` | `/opt/synconym-deploy` | 版本树、锁文件、pending 标记 |
| `SYNCONYM_LIVE_DIR` | `/www/wwwroot/synconym` | 指向当前生效后端的链接 |
| `SYNCONYM_NODE_BIN_DIR` | `/www/server/nodejs/v20.19.2/bin` | 放进 `PATH` 的 node 目录 |
| `SYNCONYM_PANEL_DIR` | `/www/server/panel` | 设为空字符串即跳过 `panel stop/start`，进程改由 systemd 托管 |

`bt-start.sh` 另有 `SYNCONYM_PUBLIC_URL`、`SYNCONYM_APP_DIR`、`SYNCONYM_NODE_BIN`、`SYNCONYM_DB_PATH`；`bt-restart.py` 另有 `SYNCONYM_PANEL_DIR`、`SYNCONYM_PANEL_PIDFILE`。

## 两条与平台无关的硬要求

1. **数据库不能放在发布目录里。** 否则切换版本会连带覆盖数据。默认 `/var/lib/synconym/synconym.db`，用 `DB_PATH` 指定，并挂持久卷。
2. **后端只监听回环地址**（`HOST=127.0.0.1`），由反向代理对外。公网直接用 HTTP/WS 会明文传输身份凭证和游戏数据。

## 自动部署的入口

`.github/workflows/deploy.yml` 负责打包并 push 到服务器，服务器侧执行的就是 `github-deploy.sh`。它需要三个 Secrets：`DEPLOY_SSH_KEY`、`DEPLOY_SSH_HOST_KEY`、`DEPLOY_HOST`。这套机制本身与面板无关，只是默认值绑定了作者的宝塔实例。
