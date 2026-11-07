# 单进程 Node 应用：前端静态文件与 WebSocket 同端口。
# 对局记录落在 /data/synconym.db，务必把这个目录挂到持久卷上。
FROM node:20-bookworm-slim

ENV NODE_ENV=production \
    PORT=3000 \
    DB_PATH=/data/synconym.db

WORKDIR /app

# better-sqlite3 12.x 在 Node 20 linux 上有预编译包，通常不需要编译工具链。
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server ./server
COPY public ./public
COPY data ./data
COPY synconym.config.json ./

RUN mkdir -p /data && chown -R node:node /data /app
USER node
VOLUME ["/data"]
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/index.js"]
