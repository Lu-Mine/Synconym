#!/usr/bin/env bash
# Forced SSH command. Infrastructure files are installed separately by an administrator.
set -Eeuo pipefail
export PATH=/www/server/nodejs/v20.19.2/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
umask 077
base=/opt/synconym-deploy
live=/www/wwwroot/synconym
front=$base/frontend-current
assets=$base/frontend
releases=$base/releases
mkdir -p "$releases" "$assets"
exec 9>"$base/deploy.lock"
chmod 755 "$base" "$assets" "$releases"
flock -w 600 9 || { echo 'Deployment is locked' >&2; exit 1; }
command=${SSH_ORIGINAL_COMMAND:-}
if [[ $command == status ]]; then
  [[ -f $front/.deployed-revision ]] || exit 1
  cat "$front/.deployed-revision"
  exit
fi
if [[ ! $command =~ ^deploy\ (frontend|backend)\ ([0-9a-f]{40})\ ([0-9a-f]{64})\ ([0-9a-f]{40})$ ]]; then
  echo 'Invalid deploy command' >&2; exit 2
fi
mode=${BASH_REMATCH[1]}
revision=${BASH_REMATCH[2]}
checksum=${BASH_REMATCH[3]}
expected=${BASH_REMATCH[4]}
previous_front=$(readlink -f "$front")
[[ -d $previous_front && $previous_front == "$assets/"* ]] || { echo 'Frontend is not initialized' >&2; exit 1; }
[[ $(cat "$previous_front/.deployed-revision") == "$expected" ]] || { echo 'Live revision changed; retry deployment' >&2; exit 1; }
archive=$(mktemp "$base/upload.XXXXXXXX.tar.gz")
trap 'rm -f "$archive"' EXIT
cat > "$archive"
echo "$checksum  $archive" | sha256sum -c -
release=$(mktemp -d "$releases/${revision:0:12}.XXXXXXXX")
tar -xzf "$archive" -C "$release" --no-same-owner
chmod 755 "$release"
new_front=$assets/$revision
if [[ -e $new_front ]]; then
  echo 'Frontend revision already exists; refusing overwrite' >&2; exit 1
fi
python3 "$base/prepare-frontend.py" "$release/public" "$new_front"
chmod -R a+rX "$new_front"
switch_front() {
  rm -f "$base/frontend.next"
  ln -s "$1" "$base/frontend.next"
  mv -Tf "$base/frontend.next" "$front"
}
verify_front() {
  local tmp
  tmp=$(mktemp "$base/verify.XXXXXXXX")
  if ! curl -fsS --max-time 5 http://127.0.0.1:3000/ -o "$tmp" || ! cmp -s "$tmp" "$new_front/index.html"; then
    rm -f "$tmp"; return 1
  fi
  rm -f "$tmp"
  curl -fsS --max-time 5 "http://127.0.0.1:3000/assets/$revision/app.js" -o /dev/null
}
if [[ $mode == frontend ]]; then
  switch_front "$new_front"
  if verify_front; then echo "Frontend deployed $revision"; exit 0; fi
  echo 'Frontend verification failed; rolling back' >&2
  switch_front "$previous_front"
  exit 1
fi
cd "$release"
export npm_config_registry=https://registry.npmmirror.com
if ! npm ci --omit=dev --no-audit --no-fund; then
  npm_config_registry=https://registry.npmjs.org npm ci --omit=dev --no-audit --no-fund
fi
printf '%s\n' "$revision" > "$release/.deployed-revision"
cp "$base/bt-start.sh" "$release/deploy/bt-start.sh"
chown -R www:www "$release"
previous=$(readlink -f "$live")
[[ -d $previous && $previous == "$releases/"* ]] || { echo 'Live release is not managed' >&2; exit 1; }
panel() { ( cd /www/server/panel && /www/server/panel/pyenv/bin/python "$base/bt-restart.py" "$1" ); }
port_free() { ! ss -lnt | awk 'NR > 1 {print $4}' | grep -Eq '(^|:)3001$'; }
healthy() {
  local i
  for i in {1..20}; do
    if curl -fsS --max-time 2 http://127.0.0.1:3001/healthz | node -e 'let s="";process.stdin.on("data",x=>s+=x);process.stdin.on("end",()=>{try{let h=JSON.parse(s);process.exit(h.status==="ok"&&h.vectors===true?0:1)}catch{process.exit(1)}})'; then return 0; fi
    sleep 2
  done
  return 1
}
switch_backend() { rm -f "$base/current.next"; ln -s "$1" "$base/current.next"; mv -Tf "$base/current.next" "$live"; }
if ! panel stop || ! port_free; then echo 'Could not stop backend' >&2; exit 1; fi
if ! switch_backend "$release"; then panel start || true; exit 1; fi
if panel start && healthy; then
  switch_front "$new_front"
  if verify_front; then echo "Backend and frontend deployed $revision"; exit 0; fi
fi
echo 'Deployment failed; rolling back backend and frontend' >&2
switch_front "$previous_front"
panel stop || true
port_free || { echo 'Rollback aborted: port 3001 occupied' >&2; exit 1; }
switch_backend "$previous"
if panel start && healthy; then echo 'Rollback succeeded' >&2; else echo 'Rollback failed; manual intervention required' >&2; fi
exit 1
