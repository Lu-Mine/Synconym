# 部署上线

本文区分**当前 ECS 的目标架构**与其他部署方式。目标是 **Apache 对外监听 `:3000`，直接提供独立前端快照；`/ws`、`/api/`、`/healthz` 反代至 Node `127.0.0.1:3001`**。仓库配置不是线上生效证明，迁移及验收见 [deploy/MIGRATION.md](deploy/MIGRATION.md)。

注意 `deploy/` 里的资产并不都是通用的：`bt-start.sh`、`bt-restart.py` 只能在 aaPanel（宝塔）里用，`github-deploy.sh` 的部分默认值也绑定宝塔布局。用 Docker / systemd / Nginx / Caddy 时请先看 [deploy/README.md](deploy/README.md)，按自己的环境挑文件。

共同前提：**Node 20+**，当前依赖为 `better-sqlite3 ^12.4.1`；升级 Node 或原生依赖前，应在目标运行环境重新安装并验证。下列 Docker、systemd、容器平台是替代方案，不要与当前 ECS 的宝塔进程管理混用。

- [一、Docker（推荐，ECS 和容器托管都能用）](#一docker)
- [二、裸机 + systemd（ECS 直接跑）](#二裸机--systemd)
- [三、容器托管平台](#三容器托管平台)
- [四、环境变量](#四环境变量)
- [五、反向代理与 HTTPS](#五反向代理与-https)
- [六、健康检查](#六健康检查)
- [七、数据与备份](#七数据与备份)
- [八、升级与发布](#八升级与发布)
- [九、排障清单](#九排障清单)

---

## 一、Docker

仓库自带 `Dockerfile`（单阶段、非 root 运行、内置健康检查）。

```bash
docker build -t synconym .

# /srv/synconym 换成一个真实存在的宿主机目录，用来放数据库
docker run -d --name synconym \
  -p 3000:3000 \
  -v /srv/synconym:/data \
  -e PUBLIC_URL=https://game.example.com \
  --restart unless-stopped \
  synconym
```

**必须挂卷到 `/data`**，否则容器一重建，所有对局记录就没了。注意是挂整个 `/data` 目录、且镜像里的 `/data` 只放数据库；主题表在 `/app/data`，不会被覆盖。

容器内的 `/healthz` 已经接到 `HEALTHCHECK`，`docker ps` 会显示 healthy / unhealthy。

---

## 二、裸机 + systemd

```bash
sudo useradd -r -s /usr/sbin/nologin synconym
sudo mkdir -p /opt/synconym /var/lib/synconym
sudo chown synconym:synconym /var/lib/synconym

# 把代码放进去（git clone 或打包上传），然后
cd /opt/synconym
sudo -u synconym npm ci --omit=dev

sudo cp deploy/synconym.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now synconym
sudo systemctl status synconym
```

改 `deploy/synconym.service` 里的 `PUBLIC_URL` 和端口后再启用。

---

## 三、容器托管平台

能用：**Railway / Render / Fly.io / Zeabur / 自建 k8s** 这类能跑常驻容器的。

不能用：**Vercel / Netlify / Cloudflare Workers / 各类函数计算**。它们跑不了长连接 WebSocket，也没有本地磁盘放 SQLite，这游戏在上面根本不成立。

在平台上要做三件事：

1. 用仓库里的 `Dockerfile` 构建
2. **挂一个持久卷到 `/data`**（不挂 = 每次部署清空记录）
3. 设 `PUBLIC_URL` 为平台给你的公开域名

HTTPS、域名、证书这些平台全包，你不用管。

---
## 配置文件

首次启动时，程序自动生成 `synconym.config.json`，已有文件不会被覆盖。默认位置：未设置 `DB_PATH` 时位于启动工作目录；设置 `DB_PATH` 时位于数据库同一目录。当前 ECS 的路径因此是 `/var/lib/synconym/synconym.config.json`，Docker 是 `/data/synconym.config.json`；二者均在版本目录之外，发布不会覆盖。也可用 `SYNCONYM_CONFIG` 指定其他路径。运行用户必须有目录写权限；修改后重启 Node 生效。

代码内置完整默认值；配置文件可以只保留需要修改的字段，缺失字段使用当前版本默认值。配置解析失败、字段未知或数值非法时服务拒绝启动。优先级：**环境变量 > 配置文件 > 内置默认值**。数据库相对路径相对于启动工作目录；生产环境请使用绝对路径。镜像和启动脚本设置的环境变量仍会覆盖文件。

从旧版升级：如果曾修改旧版本目录中的 `synconym.config.json`，请在首次启动新版前备份并复制到上述持久化位置；程序不会自动迁移旧文件或覆盖已存在的文件。若新版已生成文件，先备份两份，再人工合并需要保留的设置。

| 配置项 | 默认值 | 作用 |
|---|---:|---|
| `host` / `port` | 空 / 3000 | Node 监听地址和端口；空地址使用 Node 默认绑定 |
| `publicUrl` | 空 | 对外邀请地址，生产应使用 HTTPS 地址 |
| `dbPath` | `data/synconym.db` | SQLite 路径 |
| `maxRooms` / `wsMaxPayload` | 500 / 65536 | 房间上限 / 单条 WS 消息字节上限 |
| `security.trustProxy` | false | 是否使用反向代理提供的来源 IP |
| `security.maxGlobalConnections` / `maxConnectionsPerSource` | 1000 / 50 | 全局 / 每来源并发 WS 连接上限 |
| `security.maxAccountsPerSource` / `accountWindowMs` | 20 / 60000 | 每来源在窗口内创建或重置身份的次数 / 窗口毫秒数 |
| `security.messageBurst` / `messageRefillPerSecond` | 60 / 30 | 每连接消息令牌桶容量 / 每秒恢复数 |
| `security.globalMessageBurst` / `globalMessageRefillPerSecond` | 1000 / 500 | 全局消息令牌桶容量 / 每秒恢复数 |
| `security.handshakeTimeoutMs` | 10000 | WS 建连后完成 hello 的最长毫秒数 |

**反向代理安全**：默认不信任转发头，代理后的用户会共享代理 IP 的配额。仅当 Node 无法被客户端直接访问，且最后一跳受信代理会覆盖或追加真实对端地址到 `X-Forwarded-For` 时，才设 `trustProxy: true`；程序使用该头最右侧 IP。多层代理时此地址可能是上游代理，须按实际链路配置并验证。不要让不受信客户端直接访问后端并伪造该头。限额是单进程内存状态，重启后重置；仍需网关限流、磁盘监控及 HTTPS。

---


## 四、环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | `3000` | Node 监听端口；当前 ECS 目标设为 `3001`，Apache 对外端口仍为 `3000` |
| `HOST` | 未设置 | Node 绑定地址；当前 ECS 必须设为 `127.0.0.1`，不要将后端 `3001` 暴露公网；容器需按容器网络设置 |
| `PUBLIC_URL` | 空 | 生成邀请链接用的对外地址，例如 `https://game.example.com`。**不设的话邀请链接会指向请求时的 Host，反代后可能变成内网地址** |
| `DB_PATH` | `data/synconym.db` | SQLite 文件路径，线上指到持久卷 |
| `MAX_ROOMS` | `500` | 单进程最多同时存在多少间房，满了再建房会提示「服务器房间已满」 |
| `WS_MAX_PAYLOAD` | `65536` | 单条 WebSocket 消息字节上限，正常消息都在 1 KB 内 |

`MAX_ROOMS` 按机器内存调：一间空房占几百字节，一间打满 4 人的房占几 KB，500 这个量级主要是防滥用而不是性能瓶颈。

---

## 五、反向代理与 HTTPS

### 当前 ECS：Apache `:3000` → Node `127.0.0.1:3001`

使用 [deploy/apache.synconym.conf](deploy/apache.synconym.conf)：

- `DocumentRoot /opt/synconym-deploy/frontend-current` 提供首页和静态文件。
- `/assets/<完整提交 SHA>/...` 映射到 `/opt/synconym-deploy/frontend/<SHA>/...`，保存版本化资源；首页及非版本化资源使用 `no-cache`，版本化资源使用长期不可变缓存。
- `/ws` 转发至 `ws://127.0.0.1:3001/ws`；`/api/`、`/healthz` 转发至同一 Node 后端。
- [deploy/bt-start.sh](deploy/bt-start.sh) 设置 `HOST=127.0.0.1`、`PORT=3001`，数据库固定在 `/var/lib/synconym/synconym.db`；宝塔项目管理 Node 生命周期。

管理员需确认 Apache 的 `proxy`、`proxy_http`、`proxy_wstunnel`、`headers` 等模块及实际配置加载路径，检查端口占用，再语法检查并平滑重载；不能直接覆盖其他站点。首次从 Node `:3000` 迁移会涉及后端重启及端口交接，详见迁移指南。

**HTTP 明文限制**：仓库当前 Apache 示例没有 TLS，启动脚本的公开地址为 `http://example.com:3000`（示例值，替换为你的实际地址），因此此入口使用 HTTP/WS，**身份凭证和游戏数据可能被窃听或篡改，不应视为安全的生产入口**。正式使用应配置 HTTPS/WSS（可在 Apache 或上游终止 TLS），同步调整 `PUBLIC_URL`。HTTPS 页面不能连接明文 `ws://`；浏览器按页面协议选择 WebSocket 协议。仅将后端绑定回环地址不能保护公网这一段。

**身份凭证升级**：前后端须作为兼容版本一同发布，并通知已打开旧页面的用户刷新；旧版 WebSocket 客户端与新认证协议不兼容。旧版仅保存 UID 的身份不会自动迁移，新页面会创建新身份；旧档案仍在数据库，但不能只凭 UID 恢复访问。新身份的 UID 和凭证保存在浏览器 `localStorage` 的 `sy_identity` 中，清除站点数据会失去访问方式。更换协议、域名或端口也会改变存储源，不会自动带入原身份；HTTPS 迁移需单独规划，不要在日志或工单中暴露凭证。

以下 Caddy / Nginx 是替代入口示例，不是当前 ECS 的 Apache 安装步骤；按部署方式调整其上游端口，不要照搬默认 `3000` 指向 Apache 自身。

### Caddy（替代方案，自动管理证书）

```bash
sudo apt install caddy        # 或按官网方式安装
sudo cp deploy/Caddyfile.example /etc/caddy/Caddyfile   # 改成你的域名
sudo systemctl reload caddy
```

Caddy 会自动处理 `/ws` 的 Upgrade 转发，不用额外配置。

### Nginx

用 [deploy/nginx.synconym.conf](deploy/nginx.synconym.conf)，重点是这三行，缺了 WebSocket 握手就失败：

```nginx
proxy_http_version 1.1;
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection $connection_upgrade;
```

证书用 certbot 申请、`systemctl reload nginx` 生效。

> 机器在中国大陆时，域名要先完成备案，否则 80/443 直接不通，证书配得再对也没用。

---

## 六、健康检查

```bash
# 当前 ECS：分别检查 Node 和 Apache 转发
curl -fsS http://127.0.0.1:3001/healthz
curl -fsS http://127.0.0.1:3000/healthz
# 响应示例（不是线上实测结果）：
# {"status":"ok","rooms":3,"clients":7,"uptime":812}
```

- `rooms` / `clients` 是当前房间数和在线连接数，可直接接到监控
- 云平台探针填 `/healthz`；只有静态资源时也可以用 `/`

---

## 七、数据与备份

所有对局记录在一个 SQLite 文件里（WAL 模式）。**不要直接 `cp` 那个 .db 文件**——WAL 模式下未合并的写入在 `-wal` 文件里，直接拷会拿到旧数据。

推荐用 SQLite 自己的备份命令：

```bash
# 有 sqlite3 CLI
sqlite3 /srv/synconym/synconym.db ".backup '/backup/synconym-$(date +%F).db'"
```

或者用 Node 一行（项目里已经有 better-sqlite3）：

```bash
node -e "const D=require('better-sqlite3');const d=new D(process.argv[1],{readonly:true});d.backup(process.argv[2]).then(()=>console.log('ok'))" \
  /srv/synconym/synconym.db /backup/synconym-$(date +%F).db
```

放进 crontab 每天跑一次，保留最近 7 份就够了。

数据内容很小：一局几十行，一年几千局也才几 MB。

---

## 八、升级与发布
### GitHub Actions 自动部署（当前 ECS 目标）

`.github/workflows/deploy.yml` 在 `master` 推送或手动触发时执行 `npm ci`、`npm test`，成功后打包提交，经受限 SSH 入口上传。需要 Secrets：`DEPLOY_SSH_KEY`、`DEPLOY_SSH_HOST_KEY`、`DEPLOY_HOST`（目标主机地址，仓库中不保存真实地址）。这描述仓库工作流行为，不代表某次发布或线上迁移已成功。

#### 部署类型与兼容边界

工作流通过 `status` 读取**当前前端及后端**的两个 `.deployed-revision`，调用部署脚本的 `--classify` 与目标提交比较：

- 前后端基线可识别、前端是目标提交的祖先且后端是前端的祖先，并且**从当前后端到目标的全部差异都在 `public/`** 时，才可走 `frontend`。它生成新快照、原子切换前端链接并校验 HTTP 内容，失败则尝试恢复旧前端链接，**不重启 Node**。
- 任意非 `public/` 变更（包括仅修改文档）、提交未知或基线关系不满足安全比较时，走 `backend`。目标已在当前前端祖先链上时标为过时任务而不倒退；已达目标且后端无待更新差异时跳过。`status` 无法返回两个有效 SHA 时不能继续发布。
- 工作流最多尝试三次，每次重新获取双基线并分类。后端发布安装依赖后停止旧后端、切换版本、启动并检查健康，再切换前端并校验。失败时尝试恢复前后端，回滚本身仍可能失败，需人工处理。

**不重启不等于协议兼容**：纯前端发布必须同时兼容当前后端及已打开页面。认证协议、消息格式或 API 变化应按前后端配套升级处理；版本化静态资源只能避免混用 JS/CSS，不能让旧页面自动获得新协议。当前后端脚本要求健康响应的 `status=ok`，但这些检查不能代替浏览器对局、身份和重连验收。

#### 版本、数据与基础设施

- `/www/wwwroot/synconym` → `/opt/synconym-deploy/releases/` 中的后端完整版本。
- `/opt/synconym-deploy/frontend-current` → `/opt/synconym-deploy/frontend/<完整 SHA>` 中的前端快照；`prepare-frontend.py` 改写首页及图标引用，浏览器通过 `/assets/<SHA>/` 加载同一快照中的模块。
- SQLite 在 `/var/lib/synconym/synconym.db`，不随版本链接切换。保留当前、前一组兼容前后端及其 `.deployed-revision`；旧页面还可能请求旧 `/assets/<SHA>/`，不可只保留当前前端目录。清理前先确认引用和回滚窗口。

服务器入口 `/opt/synconym-deploy/github-deploy.sh` 和基础设施文件由管理员独立安装，普通发布不会更新它们。以下仓库文件修改后须核对服务器实际路径、备份并手动安装：

| 仓库文件 | 服务器目标 |
|---|---|
| `deploy/github-deploy.sh` | `/opt/synconym-deploy/github-deploy.sh` |
| `deploy/prepare-frontend.py` | `/opt/synconym-deploy/prepare-frontend.py` |
| `deploy/bt-restart.py` | `/opt/synconym-deploy/bt-restart.py` |
| `deploy/bt-start.sh` | `/opt/synconym-deploy/bt-start.sh`，并核对当前版本中的启动脚本及宝塔启动命令 |
| `deploy/apache.synconym.conf` | 管理员确认的 Apache 配置加载位置，不能直接套用 Nginx 路径 |

受限命令格式为 `status`（返回 `前端SHA 后端SHA`）或 `deploy frontend|backend <目标40位SHA> <归档64位SHA256> <预期前端40位SHA> <预期后端40位SHA>`。入口验证双基线、部署锁和归档安全；工作流与服务器脚本必须同步升级，旧单基线及 `deploy-frontend` 调用方式不适用。`deploy.pending` 记录未完成事务；残留时拒绝新发布，管理员须根据其中旧版本路径和实际链接完成恢复、验收后再清理标记，不能为重试直接删除。

#### 发布、回滚与重启风险

**房间和进行中的对局在内存中，后端停止、重启、故障回滚均会中断它们，不能通过切回版本恢复。** 已写入持久数据库的历史记录不随代码切换丢失。纯前端发布不主动重启 Node，但仍需验证新旧客户端兼容。

1. 查看 Actions、前后端 `.deployed-revision`、当前链接及 `http://127.0.0.1:3001/healthz`；`rooms` 不为 0 时等待低峰并提前公告。
2. 首次迁移、认证升级或有数据结构变化前，用 SQLite 备份接口备份数据库，保存前后端链接、启动环境及 Apache 配置，见[迁移指南](deploy/MIGRATION.md)。
3. 当前 ECS 只通过宝塔项目控制后端，不能再启动同名 systemd 或额外 Node 实例。其他部署方式才使用 `systemctl restart synconym` 或重建容器。
4. 发布后分别验证 Node、Apache 的健康、版本化资源、WebSocket、身份及实际对局；自动校验成功不等于完整业务验收。
5. 回滚时恢复**兼容的前后端组合**，必要时恢复基础设施。脚本不备份或回滚数据库；数据库还原前必须停止写入并备份现状，接受备份时间点之后数据丢失的风险。不要为常规代码回滚直接覆盖数据库。

Docker 换镜像时仍须保留 `/data` 挂载。这里的迁移、回滚及线上验证步骤均需实际执行并记录结果，不能将文档中的预期结果当作验证记录。

---

## 九、排障清单

| 现象 | 多半是 |
|---|---|
| 一直显示「连接中断，正在重连」 | 反代没转发 `Upgrade` / `Connection`；或套了不支持 WebSocket 的 CDN |
| 页面能打开，但建房后没反应 | 检查浏览器 `/ws` 握手及协议，HTTPS 页面应使用 WSS；确认入口支持 WebSocket、转发至 `127.0.0.1:3001`，旧认证页面须刷新 |
| 打开就是 502 / 空白 | 核对 Apache 与 Node 的监听、反代端口及宝塔项目日志；systemd / Docker 替代部署才用对应服务日志 |
| 邀请链接是 `localhost:3000` 或内网 IP | 没设 `PUBLIC_URL` |
| 重启后玩家档案里的记录没了 | `/data`(或 `DB_PATH`) 没指向持久卷 |
| 启动报 `better-sqlite3` 相关错误 | 核对 Node 20+、依赖锁文件和原生模块构建环境，切换 Node 后重新安装依赖 |

---

## 关于规模和可用性

这个应用是**单进程、房间状态在内存里**的结构：

- 适合单实例的小规模朋友局；容量应按目标机器及实际负载测试，不在此承诺未经验证的并发人数
- 但**不能多开实例做负载均衡**——两个实例各管一半房间，玩家重连会跑到另一台上去
- 想要多实例，得先把房间状态挪到 Redis 之类的地方，那是另一次改造

在此之前，正确做法是：单实例 + 一种进程守护（当前 ECS 为宝塔，替代方案为 systemd / Docker `--restart`）+ 定期备份。
