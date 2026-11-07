#!/usr/bin/env bash
# aaPanel（宝塔）「Node 项目」的启动命令模板；数据库刻意放在发布目录之外，避免随版本切换丢失。
# 默认值是作者实例的路径与地址。迁移到其他主机时改下面几个变量即可，不用改代码；
# 如果你的主机不用 aaPanel，直接用 deploy/synconym.service，不需要这个文件。
export NODE_ENV=production
export PORT=3001
export HOST=127.0.0.1
export DB_PATH=${SYNCONYM_DB_PATH:-/var/lib/synconym/synconym.db}
export PUBLIC_URL=${SYNCONYM_PUBLIC_URL:-http://example.com:3000}
app_dir=${SYNCONYM_APP_DIR:-/www/wwwroot/synconym}
node_bin=${SYNCONYM_NODE_BIN:-/www/server/nodejs/v20.19.2/bin/node}
cd "$app_dir" || exit 1
while true; do
  "$node_bin" server/index.js
  sleep 3
done
