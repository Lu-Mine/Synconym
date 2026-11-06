#!/usr/bin/env bash
# 服务端部署入口：判断变更类型，决定是纯前端发布还是服务端发布。
# 纯前端发布：只切换静态文件，不重启 Node 服务，不中断现有对局。
# 服务端发布：停止旧服务、切换完整版本、重启服务，进行中的对局会中断。
set -Eeuo pipefail
export PATH=/www/server/nodejs/v20.19.2/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
umask 077

deploy_mode=${SSH_ORIGINAL_COMMAND:-}
if [[ ! $deploy_mode =~ ^deploy(-frontend|-backend)?\ ([0-9a-f]{40})\ ([0-9a-f]{64})$ ]]; then
  echo 'Invalid deploy command' >&2; exit 2
fi
mode=${BASH_REMATCH[1]:-}  # 为空或 "-frontend" 或 "-backend"
revision=${BASH_REMATCH[3]}
checksum=${BASH_REMATCH[4]}

base=/opt/synconym-deploy
live=/www/wwwroot/synconym
releases=$base/releases
mkdir -p "$releases"

exec 9>"$base/deploy.lock"
flock -w 600 9 || { echo 'Deployment is locked' >&2; exit 1; }

archive=$(mktemp "$base/upload.XXXXXXXX.tar.gz")
release=''
cleanup() { rm -f "$archive"; }
trap cleanup EXIT

cat > "$archive"
echo "$checksum  $archive" | sha256sum -c -
release=$(mktemp -d "$releases/${revision:0:12}.XXXXXXXX")
tar -xzf "$archive" -C "$release" --no-same-owner
chmod 755 "$base" "$releases" "$release"
cd "$release"

export npm_config_registry=https://registry.npmmirror.com
if ! npm ci --omit=dev --no-audit --no-fund; then
  echo 'Mirror failed; retrying with npm registry' >&2
  npm_config_registry=https://registry.npmjs.org npm ci --omit=dev --no-audit --no-fund
fi

printf '%s\n' "$revision" > "$release/.deployed-revision"
mkdir -p "$release/deploy"
cp "$base/bt-start.sh" "$release/deploy/bt-start.sh"
chown -R www:www "$release"

panel() {
  cd /www/server/panel
  /www/server/panel/pyenv/bin/python "$base/bt-restart.py" "$1"
}

port_free() {
  ! ss -lnt | awk 'NR > 1 {print $4}' | grep -Eq '(^|:)3000$'
}

healthy() {
  local i
  for i in {1..20}; do
    if curl -fsS --max-time 2 http://127.0.0.1:3000/healthz | /www/server/nodejs/v20.19.2/bin/node -e 'let s="";process.stdin.on("data",x=>s+=x);process.stdin.on("end",()=>{try{let h=JSON.parse(s);process.exit(h.status==="ok" && h.vectors===true?0:1)}catch{process.exit(1)}})'; then return 0; fi
    sleep 2
  done
  return 1
}

switch_to() {
  local target=$1
  ln -s "$target" "$base/current.next"
  mv -Tf "$base/current.next" "$live"
}

# 纯前端发布分支
if [[ $mode == "-frontend" ]]; then
  echo "执行纯前端发布..."
  if [[ ! -d "$release/public" ]]; then
    echo "错误：版本目录缺少 public 目录" >&2
    exit 1
  fi
  
  frontend_base=$base/frontend
  frontend_current=$base/frontend-current
  mkdir -p "$frontend_base"
  frontend_release="$frontend_base/${revision:0:12}.$(date +%Y%m%d-%H%M%S)"
  
  cp -r "$release/public" "$frontend_release"
  chmod -R 755 "$frontend_release"
  printf '%s\n' "$revision" > "$frontend_release/.deployed-revision"
  date -Iseconds > "$frontend_release/.deployed-at"
  
  if [[ ! -f "$frontend_release/index.html" ]]; then
    echo "错误：新版本缺少 index.html" >&2
    rm -rf "$frontend_release"
    exit 1
  fi
  
  previous_frontend=""
  if [[ -L "$frontend_current" ]]; then
    previous_frontend=$(readlink -f "$frontend_current")
  fi
  
  rm -f "$base/frontend.next"
  ln -s "$frontend_release" "$base/frontend.next"
  mv -Tf "$base/frontend.next" "$frontend_current"
  
  sleep 1
  if curl -fsS --max-time 5 http://127.0.0.1/index.html > /dev/null 2>&1; then
    echo "前端发布成功：$revision"
    echo "新前端版本：$frontend_release"
    [[ -n "$previous_frontend" ]] && echo "旧版本（可回滚）：$previous_frontend"
    exit 0
  else
    echo "错误：新版本验证失败，正在回滚..." >&2
    if [[ -n "$previous_frontend" && -d "$previous_frontend" ]]; then
      rm -f "$base/frontend.next"
      ln -s "$previous_frontend" "$base/frontend.next"
      mv -Tf "$base/frontend.next" "$frontend_current"
      echo "已回滚到：$previous_frontend" >&2
    fi
    rm -rf "$frontend_release"
    exit 1
  fi
fi

# 后端发布流程
previous=$(readlink -f "$live")
[[ -d $previous && $previous == "$releases/"* ]] || { echo 'Live release is not managed' >&2; exit 1; }

rm -f "$base/current.next"
if ! panel stop || ! port_free; then
  echo 'Could not stop the old project cleanly; refusing to switch releases' >&2
  exit 1
fi

if ! switch_to "$release"; then
  echo 'Release switch failed; starting previous release' >&2
  panel start || true
  exit 1
fi

if panel start && healthy; then
  echo "Deployed $revision"
else
  echo 'Deployment failed; rolling back' >&2
  panel stop || true
  if ! port_free; then echo 'Rollback aborted: port 3000 is still occupied' >&2; exit 1; fi
  rm -f "$base/current.next"
  switch_to "$previous"
  if panel start && healthy; then echo 'Rollback succeeded' >&2; else echo 'Rollback failed; manual intervention required' >&2; fi
  exit 1
fi
