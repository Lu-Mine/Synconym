# 部署上线

三条路，按你手上有什么选一条就行。共同前提：**Node 20+**，`better-sqlite3` 固定在 `^12`（升 13 需要 Node 22+，在 Node 20 上会直接崩）。

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

**必须挂卷到 `/data`**，否则容器一重建，所有对局记录就没了。注意是挂整个 `/data` 目录、且镜像里的 `/data` 只放数据库；主题表和词向量在 `/app/data`，不会被覆盖。

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

## 四、环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | `3000` | 监听端口 |
| `PUBLIC_URL` | 空 | 生成邀请链接用的对外地址，例如 `https://game.example.com`。**不设的话邀请链接会指向请求时的 Host，反代后可能变成内网地址** |
| `DB_PATH` | `data/synconym.db` | SQLite 文件路径，线上指到持久卷 |
| `MAX_ROOMS` | `500` | 单进程最多同时存在多少间房，满了再建房会提示「服务器房间已满」 |
| `WS_MAX_PAYLOAD` | `65536` | 单条 WebSocket 消息字节上限，正常消息都在 1 KB 内 |

`MAX_ROOMS` 按机器内存调：一间空房占几百字节，一间打满 4 人的房占几 KB，500 这个量级主要是防滥用而不是性能瓶颈。

---

## 五、反向代理与 HTTPS

**必须全站 HTTPS**。页面是 `https://` 而 WebSocket 走 `ws://` 会被浏览器按混合内容直接掐断，表现就是「一直连接中断」。

### Caddy（最省事，证书自动申请和续期）

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
curl -s localhost:3000/healthz
# {"status":"ok","rooms":3,"clients":7,"vectors":true,"uptime":812}
```

- `rooms` / `clients` 是当前房间数和在线连接数，可直接接到监控
- `vectors` 为 `false` 表示词向量没加载，结算曲线会显示为无法计算，但游戏照常能玩
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
### GitHub Actions 自动部署（当前 ECS）

推送到 `master` 会自动运行测试，通过后打包该提交并通过 SSH 上传到 ECS。宝塔中的 `synconym` Node 项目使用 `/www/wwwroot/synconym` 符号链接指向版本目录，SQLite 仍在 `/var/lib/synconym`。部署会停止项目、切换版本并重启；健康检查或词向量加载失败时尝试回滚。进行中的对局会中断。

工作流需要仓库 Secrets：`DEPLOY_SSH_KEY` 和 `DEPLOY_SSH_HOST_KEY`。服务器部署入口位于 `/opt/synconym-deploy/github-deploy.sh`，受限 SSH 密钥只能调用该入口。服务器上的部署入口和宝塔控制脚本是独立安装的基础设施；修改 `deploy/github-deploy.sh`、`deploy/bt-restart.py` 或 `deploy/bt-start.sh` 后，需由管理员检查并手动更新 `/opt/synconym-deploy/` 中的对应文件，普通代码部署不会自动替换这些脚本。

可在 GitHub Actions 中查看发布结果，失败时检查日志；网络波动可重试。服务器保留版本目录，需由管理员按磁盘情况定期清理未使用的旧版本，切勿删除当前版本及回滚版本。


**房间状态存在内存里，重启会丢掉正在进行的对局**（已完成的对局已经入库，不会丢）。

发布流程建议：

1. `curl -s localhost:3000/healthz` 看 `rooms` 是否为 0
2. 不是 0 就等到没人在玩，或者在群里说一声
3. 拉新代码 → `npm ci --omit=dev` → `systemctl restart synconym`（或重建容器）
4. 再 `curl` 一次确认 healthy

Docker 换镜像时记得保留 `/data` 挂载，卷在容器重建后依然存在。

---

## 九、排障清单

| 现象 | 多半是 |
|---|---|
| 一直显示「连接中断，正在重连」 | 反代没转发 `Upgrade` / `Connection`；或套了不支持 WebSocket 的 CDN |
| 页面能打开，但建房后没反应 | 页面是 https 而 WebSocket 连的是 ws（混合内容被拦）。检查反代是否透传了 `X-Forwarded-Proto`，前端会按 `location.protocol` 自动选 `wss` |
| 打开就是 502 / 空白 | 服务没起来，或反代端口写错；`systemctl status` 或 `docker logs` 看启动日志 |
| 邀请链接是 `localhost:3000` 或内网 IP | 没设 `PUBLIC_URL` |
| 重启后玩家档案里的记录没了 | `/data`(或 `DB_PATH`) 没指向持久卷 |
| 结算页显示「无法计算」，曲线是虚线 | `data/vectors/` 缺失，看启动日志里「词向量已加载」那行 |
| 启动报 `better-sqlite3` 相关错误 | Node 版本不对（需要 20+），或误升到了 13.x |

---

## 关于规模和可用性

这个应用是**单进程、房间状态在内存里**的结构：

- 朋友局、几十到几百人同时在线，一台小机器完全够（实测 10 房 × 4 人并发操作无异常）
- 但**不能多开实例做负载均衡**——两个实例各管一半房间，玩家重连会跑到另一台上去
- 想要多实例，得先把房间状态挪到 Redis 之类的地方，那是另一次改造

在此之前，正确做法是：单实例 + 进程守护（systemd / `--restart`）+ 定期备份。
