# 前后端分离部署实施指南

## 概述

本指南用于在服务器上实施前后端分离部署架构。完成后，纯前端更新可以不重启 Node 服务、不中断现有对局。

## 准备工作

确保以下内容已就绪：
- 服务器 SSH root 访问
- 当前项目正常运行
- `/opt/synconym-deploy/` 已存在且包含当前部署脚本
- 宝塔面板 Node 项目 `synconym` 已配置
- Nginx 已安装并配置 HTTPS

## 实施步骤

### 1. 备份当前配置

```bash
# 在服务器上执行
cd /opt/synconym-deploy
cp github-deploy.sh github-deploy.sh.backup
cp /etc/nginx/sites-available/synconym.conf /etc/nginx/sites-available/synconym.conf.backup  # 或对应路径
```

### 2. 更新部署脚本

从项目仓库复制新版本的部署脚本到服务器：

```bash
# 本地执行
scp deploy/github-deploy.sh root@example.com:/opt/synconym-deploy/github-deploy.sh
scp deploy/bt-restart.py root@example.com:/opt/synconym-deploy/bt-restart.py
scp deploy/bt-start.sh root@example.com:/opt/synconym-deploy/bt-start.sh

# 在服务器上设置权限
ssh root@example.com 'chmod +x /opt/synconym-deploy/github-deploy.sh /opt/synconym-deploy/bt-start.sh'
```

### 3. 初始化前端目录

在服务器上创建前端独立版本目录并建立初始符号链接：

```bash
# 在服务器上执行
cd /opt/synconym-deploy
mkdir -p frontend

# 从当前运行版本复制前端文件作为初始版本
current_release=$(readlink -f /www/wwwroot/synconym)
current_revision=$(cat "$current_release/.deployed-revision")
frontend_initial="frontend/${current_revision:0:12}.$(date +%Y%m%d-%H%M%S)"

cp -r "$current_release/public" "$frontend_initial"
chmod -R 755 "$frontend_initial"
printf '%s\n' "$current_revision" > "$frontend_initial/.deployed-revision"
date -Iseconds > "$frontend_initial/.deployed-at"

# 创建符号链接
ln -s "$frontend_initial" frontend-current
```

验证前端目录结构：

```bash
ls -la /opt/synconym-deploy/frontend-current/
# 应该看到 index.html, styles.css, app.js 等文件
```

### 4. 更新 Nginx 配置

用新的配置替换现有 Nginx 配置：

```bash
# 本地执行（注意替换域名和证书路径）
scp deploy/nginx.synconym-split.conf root@example.com:/etc/nginx/sites-available/synconym.conf

# 在服务器上编辑配置，替换示例域名和证书路径
ssh root@example.com 'vim /etc/nginx/sites-available/synconym.conf'
```

配置要点：
- 将 `game.example.com` 替换为实际域名
- 将证书路径替换为实际路径
- 确认 `root /opt/synconym-deploy/frontend-current;` 路径正确

测试并重载 Nginx：

```bash
ssh root@example.com 'nginx -t && systemctl reload nginx'
```

### 5. 验证配置

在不重启 Node 服务的情况下验证新配置：

```bash
# 检查静态文件是否由 Nginx 提供
curl -I https://your-domain.com/index.html
# 应该看到 Server: nginx

# 检查 WebSocket 路径可达
curl -I https://your-domain.com/ws
# 应该看到 Upgrade 相关响应

# 检查健康检查
curl https://your-domain.com/healthz
# 应该返回 {"status":"ok",...}
```

### 6. 测试前端独立发布

创建一个测试性的前端小改动（比如修改一个文案），推送到 master 分支，观察 GitHub Actions：

- 在 Actions 中查看 "Determine deployment type" 步骤输出
- 确认显示 "纯前端变更，使用前端发布"
- 确认部署成功且没有重启 Node 服务
- 检查 `/healthz` 中的 `rooms` 和 `clients` 数量在发布前后没有清零

### 7. 验证完整流程

建立一个测试房间并保持连接，然后：

1. 修改 `public/` 下的文件（如改一个按钮文案）
2. 推送到 master
3. 观察 GitHub Actions 日志，确认走的是前端发布流程
4. 确认测试房间的连接没有断开
5. 刷新页面，确认新文案已生效

## 回滚方案

如果前端分离部署出现问题，可以快速回滚：

### 方案 A：回滚到原有部署方式

```bash
# 在服务器上执行
cd /opt/synconym-deploy
cp github-deploy.sh.backup github-deploy.sh

# 恢复原 Nginx 配置
cp /etc/nginx/sites-available/synconym.conf.backup /etc/nginx/sites-available/synconym.conf
nginx -t && systemctl reload nginx
```

此时回到全部由 Node 提供静态文件的模式。

### 方案 B：修复前端符号链接

如果只是前端版本切换失败：

```bash
# 列出可用的前端版本
ls -la /opt/synconym-deploy/frontend/

# 切换到特定版本
cd /opt/synconym-deploy
rm -f frontend.next
ln -s frontend/版本目录 frontend.next
mv -Tf frontend.next frontend-current
```

## 监控建议

部署完成后，监控以下指标：

- GitHub Actions 部署日志中的部署类型判断
- 前端发布时 `/healthz` 的 `rooms` 和 `clients` 是否保持稳定
- 后端发布时是否正确重启并通过健康检查
- Nginx 访问日志中静态文件请求的响应时间

## 注意事项

1. **首次部署**：建议在低峰期进行，确保有足够时间验证和处理问题
2. **磁盘空间**：前端版本目录会随着发布累积，需定期清理旧版本
3. **缓存策略**：新配置中 HTML 不缓存、JS/CSS 长缓存，确保用户能及时获取更新
4. **监控告警**：建议配置 healthz 监控，异常时及时通知

## 常见问题

### Q: 前端发布后页面还是旧版本？

检查：
- 浏览器是否缓存了 HTML（应配置为 no-cache）
- Nginx 是否正确重载配置
- 符号链接是否指向正确版本

### Q: WebSocket 连接失败？

检查：
- Nginx 配置中 `/ws` location 是否包含 Upgrade 和 Connection 头
- Node 服务是否正常监听 3000 端口
- 防火墙规则是否允许内部转发

### Q: 部署脚本正则匹配失败？

确认 SSH 命令格式：
- 前端发布：`deploy-frontend <sha> <checksum>`
- 后端发布：`deploy <sha> <checksum>` 或 `deploy-backend <sha> <checksum>`

## 完成确认

✅ Nginx 直接提供静态文件  
✅ WebSocket、API 和健康检查正确转发到 Node  
✅ 前端独立发布不重启 Node 服务  
✅ GitHub Actions 自动判断部署类型  
✅ 回滚方案已验证可用  

完成以上确认后，前后端分离部署架构即已生效。
