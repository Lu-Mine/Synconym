# Apache 前后端分离部署迁移指南

> **适用范围**：本文记录的是作者当前实例（aaPanel 宝塔 + Apache）的具体迁移过程，含该主机的实际目录布局。它**不是通用部署要求**——Docker、systemd、Nginx、Caddy 等做法见 [DEPLOY.md](../DEPLOY.md)，各文件适用哪种环境见 [README.md](README.md)。

## 目标与边界

本指南描述**待实施和验收的目标**，不代表服务器已经完成迁移或回滚演练：

```text
浏览器 → Apache :3000
          ├─ /、静态文件 → /opt/synconym-deploy/frontend-current
          ├─ /assets/<完整SHA>/... → /opt/synconym-deploy/frontend/<SHA>/...
          └─ /ws、/api/、/healthz → Node 127.0.0.1:3001
```

- 后端链接 `/www/wwwroot/synconym` 指向 `/opt/synconym-deploy/releases/` 中的完整项目版本。
- 前端链接独立切换，快照由 `deploy/prepare-frontend.py` 从 `public/` 构建，保留相对模块引用及版本化图标引用。
- 数据库固定在 `/var/lib/synconym/synconym.db`，不放进版本目录。
- 宝塔项目 `synconym` 管理 Node；不要同时用 systemd、手动 Node 或另一进程守护启动第二实例。
- 纯前端发布不主动重启 Node；后端发布、首次改端口及后端回滚都会中断内存中的房间和进行中对局。切回代码不能恢复这些状态。

**明文限制**：`deploy/apache.synconym.conf` 仅配置 HTTP `:3000`，`deploy/bt-start.sh` 的 `PUBLIC_URL` 是 `http://example.com:3000`（示例值，替换为你的实际地址）。HTTP/WS 会明文传输身份凭证和游戏数据，存在窃听、冒用及篡改风险；这不是安全生产入口。正式开放应配置 HTTPS/WSS，并同步更新 `PUBLIC_URL`。后端绑定回环仅保护内网监听，不能保护公网明文流量。更换协议、域名或端口会改变浏览器存储源，身份不会自动带入新入口，须另行规划迁移。

## 迁移前检查

1. 管理员具备 SSH 和宝塔管理权限，确认实际 Apache 可执行文件、主配置、站点包含路径及平滑重载方式。宝塔 Apache 不一定是系统的 `apache2` / `httpd` 服务，不能套用 Nginx 路径或覆盖其他站点。
2. 确认 Node 20+、匹配的原生依赖、Python 3、SQLite CLI、`curl`、`flock`、`ss` 等可用；宝塔控制脚本依赖面板 Python 环境及 `psutil`。
3. 核对 `deploy/bt-start.sh` 中 Node 路径、`HOST=127.0.0.1`、`PORT=3001`、数据库路径和 `PUBLIC_URL`；核对宝塔启动命令实际执行的脚本。确认数据库及父目录对运行用户 `www` 的权限。
4. 记录当前端口占用：`ss -lntp | grep -E ':(3000|3001)\b'`。若 Node 仍占 `3000`，Apache 不能先占用同一端口；安排维护窗口交接。防火墙只开放所需入口，不开放后端 `3001`。
5. 检查当前健康、房间和连接数，低峰公告后再操作。暂停自动发布，避免 Actions 和管理员同时切换版本；操作期间协调部署锁。
6. 确认当前后端在受管理的 `releases/` 下，前后端 SHA 可追溯。缺失 `.deployed-revision` 时先根据实际发布记录确定提交，不能猜 SHA 或将未核实代码标成某个版本。新部署入口要求已有有效的前端版本基线。

## 1. 备份配置、版本与数据库

以下命令在服务器 Bash 中由管理员执行，变量在同一会话保留；先将配置占位符换成**实际加载的游戏站点配置**。如果该文件含其他站点，应先拆分或制定单独变更方案。另行保存相关 include、监听配置和宝塔项目启动配置；单个站点文件备份不等于全部基础设施备份。

```bash
set -euo pipefail
base=/opt/synconym-deploy
APACHE_CONF=/实际加载的Apache游戏站点配置路径
# 确认路径后再执行
test -f "$APACHE_CONF"
backup="$base/backups/$(date +%Y%m%d-%H%M%S)"
install -d -m 700 "$backup"
printf '%s\n' "$APACHE_CONF" > "$backup/apache-conf-path"
cp -a "$APACHE_CONF" "$backup/apache-game.conf"
for file in github-deploy.sh prepare-frontend.py bt-restart.py bt-start.sh; do
  if [ -f "$base/$file" ]; then cp -a "$base/$file" "$backup/$file"; fi
done
readlink -f /www/wwwroot/synconym > "$backup/backend-target"
if [ -L "$base/frontend-current" ]; then
  readlink -f "$base/frontend-current" > "$backup/frontend-target"
fi
sqlite3 /var/lib/synconym/synconym.db ".backup '$backup/synconym.db'"
sqlite3 "$backup/synconym.db" 'PRAGMA integrity_check;'
```

完整性检查预期返回 `ok`；还应确认备份文件、大小和权限，并记录时间。若实际 `DB_PATH` 不同，先修正源路径，避免误建空库。SQLite 使用 WAL，**不可只复制在线 `.db` 文件**；使用 `.backup` 或数据库备份 API。将关键备份转存到服务器之外。备份含个人历史和凭证哈希，应限制访问。

## 2. 安装独立基础设施

从管理员选定的同一兼容提交上传以下文件到 `/opt/synconym-deploy/`，核对校验和及内容后安装；这些文件**不会随普通代码发布自动更新**：

- `deploy/github-deploy.sh`
- `deploy/prepare-frontend.py`（不能遗漏，发布时负责生成快照）
- `deploy/bt-restart.py`
- `deploy/bt-start.sh`

保持脚本及父目录仅管理员可写；`github-deploy.sh`、`bt-start.sh` 需要执行权限，Python 文件由解释器调用、需可读。宝塔实际启动的版本目录脚本也必须一致，不能只更新独立副本就假定当前进程环境已改变。不要在运行中的旧版本上无备份覆盖文件。

受限 SSH 入口需与 `.github/workflows/deploy.yml` 同步，接受的命令为：

```text
status
deploy frontend <目标40位SHA> <归档64位SHA256> <预期前端40位SHA> <预期后端40位SHA>
deploy backend <目标40位SHA> <归档64位SHA256> <预期前端40位SHA> <预期后端40位SHA>
```

`status` 返回 `前端SHA 后端SHA`（空格分隔），两个版本必须来自有效受管理链接及版本标记。旧单基线协议及 `deploy-frontend` / `deploy-backend` 格式不适用，必须同步升级工作流和服务器入口。保留 SSH forced-command 限制及主机密钥校验，不要用开放 root shell 替代自动部署凭证。

## 3. 初始化前端不可变快照

仅在**已核实该版本与准备运行的后端兼容**时执行。认证协议升级不能从旧 `public/` 随意复制一份与新后端混用；应准备同一兼容提交的完整后端和前端。

```bash
current_release=$(readlink -f /www/wwwroot/synconym)
current_revision=$(cat "$current_release/.deployed-revision")
[[ "$current_revision" =~ ^[0-9a-f]{40}$ ]]
install -d -m 755 "$base/frontend" "$base/releases"
initial="$base/frontend/$current_revision"
# 工具要求目标目录不存在；已有同 SHA 快照时先核验，不能覆盖不可变版本
test ! -e "$initial"
python3 "$base/prepare-frontend.py" "$current_release/public" "$initial" "$current_revision"
chmod -R a+rX "$initial"
# 确认 frontend-current 不是真实目录，且没有其他发布在进行
test ! -e "$base/frontend-current" || test -L "$base/frontend-current"
test ! -e "$base/frontend.next" && test ! -L "$base/frontend.next"
ln -s "$initial" "$base/frontend.next"
mv -Tf "$base/frontend.next" "$base/frontend-current"
```

若初次运行时不存在 `.deployed-revision`，或 `frontend-current` 是真实目录，先停下并核实现状，不要强行删除。若已有相同 SHA 快照，验证其内容及版本标记后可直接使用；不要重复执行构建覆盖。检查首页引用 `/assets/<SHA>/app.js`、样式及模块文件确实存在，Apache 用户可以遍历父目录并读取文件。

## 4. 切换后端端口和 Apache

1. 在维护窗口准备兼容后端版本、完成 `npm ci --omit=dev`，保存其 `.deployed-revision`。确认数据目录不会被代码替换。若当前后端并非受管理的版本目录，先迁入 `releases/` 并保留原目录及链接，自动部署脚本不会替管理员完成这一初始迁移。
2. 用宝塔仅停止 `synconym` 项目，确认旧 Node 和启动循环已退出、`3000` / `3001` 无冲突。后端切换后用核实过的 `bt-start.sh` 启动，确认 Node **仅**监听 `127.0.0.1:3001`。
3. 检查 `curl -fsS http://127.0.0.1:3001/healthz`。当前部署脚本要求 `status=ok` 且 `vectors=true`；若词向量未加载，不应把启动当作发布成功。
4. 将 `deploy/apache.synconym.conf` 的内容合并到实际 Apache 配置，核对 `ServerName`、唯一的 `Listen 3000`、两个静态目录和三个反代路径，避免已有 `Listen` 重复定义。确认启用 `proxy`、`proxy_http`、`proxy_wstunnel`、`headers` 等所需模块及目录访问权限。
5. 使用**该服务器实际运行的 Apache 程序及配置参数**执行语法检查；失败不得重载。检查通过后按该实例的管理方式平滑重载，仅变更游戏入口，不重启整个面板或影响其他站点。
6. 检查 Apache 监听 `:3000`、Node 监听 `127.0.0.1:3001`；再执行下一节验收。记录实际命令和结果，不把本指南当作已执行记录。

## 5. 分层验收（以下均待实际执行）

### HTTP、版本和缓存

```bash
curl -fsS http://127.0.0.1:3001/healthz
curl -fsS http://127.0.0.1:3000/healthz
probe=$(mktemp)
curl -fsS http://127.0.0.1:3000/ -o "$probe"
cmp "$probe" "$base/frontend-current/index.html"
revision=$(cat "$base/frontend-current/.deployed-revision")
curl -fsSI "http://127.0.0.1:3000/assets/$revision/app.js"
curl -fsSI http://127.0.0.1:3000/index.html
curl -fsS http://127.0.0.1:3000/api/playing
rm -f "$probe"
```

对外入口还须从服务器外部检查，若已配置 TLS 改用实际 HTTPS 地址。核对首页内容和前端版本一致，版本化资源可读且带长期不可变缓存，首页及非版本化文件为 `no-cache`。不要仅凭 `Server` 响应头判断请求来自哪个目录；需比较内容、查看日志并检查版本化 URL。API 的预期结构以当前接口为准。

### WebSocket 与业务

- 在浏览器网络面板确认 `/ws` 返回 `101 Switching Protocols`，并验证 `hello`、身份、创建/加入房间、操作和重连。普通 `curl -I /ws` **不是 WebSocket 握手验证**。
- 当前协议使用 UID + 凭证；新页面把它们保存在 `localStorage.sy_identity`。旧版只有 UID 的身份不会自动升级，新页面会获得新身份；旧档案仍在库中，但不能只凭 UID 恢复访问。清除站点数据会丢失凭证，不应当作常规故障处理方式。
- 认证升级须配套发布前后端并通知旧页面刷新；旧客户端不能与新认证协议正常互通。新身份生成、凭证恢复及身份异常提示需分别验收，不要把凭证粘贴到日志或工单。
- 让一个测试房间保持连接，再观察一次**实际需要的**兼容纯前端发布：确认日志走 `frontend`、Node PID / 启动时间未变化，现有房间可继续，刷新能加载新版本。不要仅凭 `rooms` / `clients` 数值未清零断言无中断，也无需为验收推送无意义改动。
- 完整后端发布会重启 Node，应在维护窗口验收恢复服务及新建对局，而不是要求旧对局保留。

## 发布判断和保留策略

工作流读取当前前后端双 SHA，调用 `github-deploy.sh --classify`：仅当前端是目标祖先、后端是前端祖先，且**后端到目标**的全部差异在 `public/` 时，才可走 `frontend`。任意非 `public/` 改动（含文档）、未知提交或不满足安全基线关系时走 `backend`。目标是当前前端的较旧祖先时跳过过时任务；前端已到目标且后端无待更新差异时跳过重复发布。工作流最多尝试三次，每次重新获取和校验双基线；无效 `status` 不继续发布。静态快照只能解决前端资源跨版本混用，不能解决前后端协议不兼容，仍须验收已打开的旧页面。

保留当前及上一组兼容的后端完整版本、前端快照、SHA、独立脚本、Apache 配置和数据库备份。旧页面可能继续加载旧 `/assets/<SHA>/` 资源，不能发布后立即删掉旧前端目录。当前脚本不自动清理版本，管理员按磁盘、引用及回滚窗口制定清理策略。

## 回滚方案

先暂停自动部署、记录失败状态、确认目标版本兼容，并协调部署锁。`/opt/synconym-deploy/deploy.pending` 存在时，记录其中原前端、原后端路径及实际链接；入口会拒绝后续发布，须完成恢复并验收后再清理该标记，不能仅为重试而删除。**回滚不是零停机保证**，后端重启无法恢复内存对局。不要因脚本输出了回滚日志就假定恢复成功。

### A. 仅前端版本切换

仅适用于旧前端与当前后端兼容的情况；下面将占位符替换为已核实的绝对快照路径：

```bash
previous_front=/opt/synconym-deploy/frontend/已核实的完整SHA
test -f "$previous_front/index.html"
test ! -e "$base/frontend-current" || test -L "$base/frontend-current"
test ! -e "$base/frontend.next" && test ! -L "$base/frontend.next"
ln -s "$previous_front" "$base/frontend.next"
mv -Tf "$base/frontend.next" "$base/frontend-current"
```

重新核对首页、版本化资源和业务连接。无需因此重启 Node；跨认证协议或 API 版本时不能只退前端。

### B. 恢复兼容前后端组合及基础设施

1. 从备份的 `backend-target`、`frontend-target` 和版本记录确定原组合。若备份前尚无独立前端，须先恢复原有提供静态文件的入口，不能引用不存在的链接。
2. 用当前可用的宝塔控制方式停止 `synconym`，确认监听释放；使用同目录临时链接和 `mv -Tf` 恢复 `/www/wwwroot/synconym`，恢复兼容前端链接。
3. 按需恢复备份的独立部署脚本、启动脚本、宝塔项目设置及 Apache 游戏配置；先语法检查再平滑重载。恢复旧端口布局时必须协调端口交接：若旧 Node 要占 `3000`，先撤掉 Apache 的游戏 `Listen 3000`，但不要停止其他站点。
4. 用原启动环境启动后端，分别检查监听、健康、静态资源、WebSocket 和实际身份/对局。恢复后再次记录前后端 SHA 和配置版本，确认后才恢复自动部署。

自动发布脚本在事务开始后的失败或可捕获中断时尝试恢复原前端；若已触碰后端，则同时尝试恢复后端并重新验证。SIGKILL、掉电等无法靠退出处理恢复，须检查 `deploy.pending` 并人工处理。端口无法释放、宝塔启动失败等也可能使回滚失败。脚本不恢复独立基础设施，也**不备份或还原数据库**。

### C. 数据库恢复（仅确有必要时）

常规代码回滚不要直接覆盖数据库。认证升级会创建 `player_credentials` 表，历史数据保留，但旧 UID 不会自动获得新凭证。回滚到不校验凭证的旧后端会重新引入旧的身份安全风险，不能作为无风险方案。

若数据确需还原：先停止后端和所有写入，用 SQLite 备份接口保存故障现状，确认备份完整及目标代码兼容后再由管理员恢复。妥善处理现有 `-wal` / `-shm`，不可让旧 WAL 与还原库混用，恢复运行用户权限后启动并检查。还原会丢失备份时间点后的记录、身份及凭证映射，浏览器已有凭证也可能失效；须提前确认可接受损失并通知用户。

## 完成记录（未勾选即未验收）

- [ ] 备份路径、完整性和异地副本已记录；回滚目标明确。
- [ ] Apache `:3000` 与 Node `127.0.0.1:3001` 监听及外网访问已验证。
- [ ] 首页、版本化模块/图标、缓存和 API 均符合目标。
- [ ] WebSocket 握手、身份升级/恢复、对局与重连已实测。
- [ ] 兼容纯前端发布未重启 Node，完整后端发布风险已确认。
- [ ] HTTP 明文风险已记录，HTTPS/WSS 与存储源迁移方案已确认。
- [ ] 回滚演练结果、实际命令、时间及未完成项已记录。

仅实际完成后填写验收记录；本指南本身不提供线上可用性或回滚成功的证明。
