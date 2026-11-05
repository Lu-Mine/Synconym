#!/usr/bin/env bash
# Persistent aaPanel entrypoint; database is deliberately outside the release tree.
export NODE_ENV=production
export PORT=3000
export DB_PATH=/var/lib/synconym/synconym.db
export PUBLIC_URL=http://example.com:3000
cd /www/wwwroot/synconym || exit 1
while true; do
  /www/server/nodejs/v20.19.2/bin/node server/index.js
  sleep 3
done
