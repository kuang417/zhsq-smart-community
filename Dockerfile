# 智慧社区治理平台 · 生产镜像（单机单实例 / SQLite WAL）
# 构建：docker compose build   运行：docker compose up -d
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
# 构建前端；种子 JSON 仅用于构建期的开发/测试环境，绝不复制进运行镜像
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8081 \
    ZHSQ_DB_FILE=/app/data/zhsq.db
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
# migrate 需要 DDL 基线 sql/schema.sqlite.sql（Dockerfile 注释必须独占一行）
COPY --from=build /app/sql ./sql
# 只复制后端源码：server/data/db.json、bulk.json（含明文账号/身份证/手机号）与开发密钥
# 均留在构建阶段，不会进入最终镜像层
COPY --from=build /app/server/*.js ./server/
COPY deploy/docker-entrypoint.sh /usr/local/bin/entrypoint.sh
RUN mkdir -p /app/data /app/server/data/backups /app/sql \
 && chown -R node:node /app \
 && chmod +x /usr/local/bin/entrypoint.sh
USER node
EXPOSE 8081
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8081)+'/api/health').then(r=>r.json().then(j=>process.exit(r.ok&&j.code===0?0:1))).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["node", "server/index.js"]
