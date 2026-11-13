#!/bin/sh
# 生产首次启动：由服务自身创建「空业务库 + 管理员账号」（不再灌演示种子数据）。
# 已有库文件一律原样复用，绝不重建，避免误覆盖真实业务数据。
set -e
DB_FILE="${ZHSQ_DB_FILE:-/app/server/data/zhsq.db}"
mkdir -p "$(dirname "$DB_FILE")" /app/server/data/backups

if [ ! -f "$DB_FILE" ]; then
  echo "[entrypoint] 首次启动：将创建空业务库，管理员初始密码取自 ZHSQ_ADMIN_PASSWORD"
else
  echo "[entrypoint] 复用已有数据库：$DB_FILE"
fi

exec "$@"
