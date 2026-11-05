#!/usr/bin/env bash
# Server-side forced command: read a release archive from stdin and deploy it.
set -Eeuo pipefail
export PATH=/www/server/nodejs/v20.19.2/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
umask 077
command=${SSH_ORIGINAL_COMMAND:-}
if [[ ! $command =~ ^deploy\ ([0-9a-f]{40})\ ([0-9a-f]{64})$ ]]; then
  echo 'Invalid deploy command' >&2; exit 2
fi
revision=${BASH_REMATCH[1]}
checksum=${BASH_REMATCH[2]}
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
# The start wrapper is infrastructure, kept outside the release archives.
mkdir -p "$release/deploy"
cp "$base/bt-start.sh" "$release/deploy/bt-start.sh"
chown -R www:www "$release"
previous=$(readlink -f "$live")
[[ -d $previous && $previous == "$releases/"* ]] || { echo 'Live release is not managed' >&2; exit 1; }
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
