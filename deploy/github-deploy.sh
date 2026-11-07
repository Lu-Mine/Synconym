#!/usr/bin/env bash
# Forced SSH command. Infrastructure files are installed separately by an administrator.
# Sourcing this file only defines functions; --classify is a local, read-only CI entrypoint.
#
# 可移植性：默认值对应作者的 aaPanel + Apache 实例。换主机时依次改 SYNCONYM_NODE_BIN_DIR、
# SYNCONYM_DEPLOY_BASE、SYNCONYM_LIVE_DIR（configure_deployment 读取），不需要改代码。
# 目录结构见 deploy/MIGRATION.md 的「服务器布局」一节。

valid_revision() { [[ $1 =~ ^[0-9a-f]{40}$ ]]; }

classify_deployment() {
  local frontend=$1 backend=$2 target=$3 file changed mode=frontend
  valid_revision "$frontend" && valid_revision "$backend" && valid_revision "$target" || return 2
  git cat-file -e "$target^{commit}" || return 2
  if ! git cat-file -e "$frontend^{commit}" 2>/dev/null || ! git cat-file -e "$backend^{commit}" 2>/dev/null; then
    echo backend; return
  fi
  # An older queued workflow must not undo a newer deployment.
  if { [[ $frontend != "$target" ]] && git merge-base --is-ancestor "$target" "$frontend"; } ||
     { [[ $backend != "$target" ]] && git merge-base --is-ancestor "$target" "$backend"; }; then
    echo stale; return
  fi
  if ! git merge-base --is-ancestor "$frontend" "$target" || ! git merge-base --is-ancestor "$backend" "$frontend"; then
    echo backend; return
  fi
  changed=$(mktemp) || return 1
  # Compare against BOTH live revisions. A frontend marker alone cannot certify the backend.
  if ! git diff --name-only -z --no-renames "$backend" "$target" > "$changed"; then
    rm -f "$changed"; return 1
  fi
  while IFS= read -r -d '' file; do
    if [[ $file != public/* ]]; then mode=backend; break; fi
  done < "$changed"
  rm -f "$changed"
  if [[ $frontend == "$target" && $mode == frontend ]]; then echo none; else echo "$mode"; fi
}

managed_target() {
  local link=$1 root=$2 resolved
  [[ -L $link ]] || return 1
  resolved=$(readlink -f "$link") || return 1
  [[ -d $resolved && $resolved == "$root/"* ]] || return 1
  printf '%s\n' "$resolved"
}

read_revision() {
  local value
  value=$(cat "$1/.deployed-revision") || return 1
  valid_revision "$value" || return 1
  printf '%s\n' "$value"
}

switch_link() {
  local target=$1 link=$2 next=$3
  rm -f "$next" || return 1
  ln -s "$target" "$next" || return 1
  mv -Tf "$next" "$link"
}
switch_front() { switch_link "$1" "$front" "$base/frontend.next"; }
switch_backend() { switch_link "$1" "$live" "$base/current.next"; }

verify_front() {
  local target=$1 revision file relative encoded tmp files
  revision=$(read_revision "$target") || return 1
  tmp=$(mktemp "$base/verify.XXXXXXXX") || return 1
  if ! curl -fsS --max-time 5 http://127.0.0.1:3000/ -o "$tmp" || ! cmp -s "$tmp" "$target/index.html"; then
    rm -f "$tmp"; return 1
  fi
  files=$(mktemp "$base/verify-files.XXXXXXXX") || { rm -f "$tmp"; return 1; }
  find "$target" -type f -print0 > "$files" || { rm -f "$tmp" "$files"; return 1; }
  # Verify every module/asset, not just the six entrypoint files.
  while IFS= read -r -d '' file; do
    relative=${file#"$target/"}
    [[ $relative == .* ]] && continue
    encoded=$(python3 -c 'import sys,urllib.parse; print(urllib.parse.quote(sys.argv[1]))' "$relative") || { rm -f "$tmp" "$files"; return 1; }
    if ! curl -fsS --globoff --path-as-is --max-time 5 "http://127.0.0.1:3000/assets/$revision/$encoded" -o "$tmp" || ! cmp -s "$tmp" "$file"; then
      rm -f "$tmp" "$files"; return 1
    fi
  done < "$files"
  rm -f "$tmp" "$files"
}

# aaPanel（宝塔）负责本项目的进程启停。如果你的主机不用 aaPanel，把 SYNCONYM_PANEL_DIR
# 设为空字符串（export SYNCONYM_PANEL_DIR=），下面的 panel stop/start 就变成空操作，
# 进程改由 systemd / supervisor 等托管，可参考 deploy/synconym.service。
panel() {
  local dir=${SYNCONYM_PANEL_DIR-/www/server/panel}
  [[ -n $dir ]] || return 0
  ( cd "$dir" && "$dir/pyenv/bin/python" "$base/bt-restart.py" "$1" )
}
port_free() {
  local listeners
  listeners=$(ss -H -lnt) || return 1
  ! awk '{print $4}' <<< "$listeners" | grep -Eq '(^|:)3001$'
}
wait_free() { local i; for i in {1..15}; do port_free && return 0; sleep 1; done; return 1; }
healthy() {
  local i
  for i in {1..20}; do
    if curl -fsS --max-time 2 http://127.0.0.1:3001/healthz | node -e 'let s="";process.stdin.on("data",x=>s+=x);process.stdin.on("end",()=>{try{let h=JSON.parse(s);process.exit(h.status==="ok"&&h.vectors===true?0:1)}catch{process.exit(1)}})'; then return 0; fi
    sleep 2
  done
  return 1
}

rollback_deployment() {
  local failed=0
  echo 'Deployment failed; restoring previous release(s)' >&2
  # Always attempt both restorations, even if one of them fails.
  switch_front "$previous_front" || failed=1
  if [[ $backend_touched == 1 ]]; then
    panel stop || echo 'Rollback: stop reported failure; checking port' >&2
    if wait_free; then
      if switch_backend "$previous"; then
        panel start || echo 'Rollback: start reported failure; checking health' >&2
        healthy || failed=1
      else failed=1
      fi
    else
      echo 'Rollback aborted: port 3001 occupied' >&2
      failed=1
    fi
  fi
  verify_front "$previous_front" || failed=1
  if (( failed )); then
    echo 'Rollback failed; manual intervention required (deploy.pending retained)' >&2
    return 1
  fi
  rm -f "$base/deploy.pending" || return 1
  echo 'Rollback succeeded' >&2
}

deploy_cleanup() {
  local result=$?
  trap - EXIT HUP INT TERM
  if [[ ${transaction_started:-0} == 1 && ${committed:-0} != 1 ]]; then
    rollback_deployment || true
    result=1
  fi
  [[ -z ${archive:-} ]] || rm -f "$archive"
  [[ -z ${candidate:-} ]] || rm -rf "$candidate"
  rm -f "$base/frontend.next" "$base/current.next"
  exit "$result"
}

validate_archive() {
  # Checksums do not make uploaded tar paths safe. Reject links, traversal and devices before extraction.
  python3 - "$1" <<'PY'
import pathlib
import sys
import tarfile

seen = set()
with tarfile.open(sys.argv[1], 'r:gz') as archive:
    for member in archive:
        path = pathlib.PurePosixPath(member.name)
        if (not member.name or path.is_absolute() or '..' in path.parts
                or '\\' in member.name or any(ord(c) < 32 for c in member.name)
                or not (member.isfile() or member.isdir()) or str(path) in seen):
            raise SystemExit('Unsafe archive member: ' + repr(member.name))
        seen.add(str(path))
PY
}

deploy_release() {
  archive= candidate= transaction_started=0 committed=0 backend_touched=0
  trap deploy_cleanup EXIT
  trap 'exit 129' HUP
  trap 'exit 130' INT
  trap 'exit 143' TERM
  archive=$(mktemp "$base/upload.XXXXXXXX.tar.gz")
  cat > "$archive"
  echo "$checksum  $archive" | sha256sum -c -
  validate_archive "$archive"
  release=$(mktemp -d "$releases/${revision:0:12}.XXXXXXXX")
  tar -xzf "$archive" -C "$release" --no-same-owner --no-same-permissions
  chmod 755 "$release"
  new_front=$assets/$revision
  candidate=$(mktemp -d "$base/frontend-build.XXXXXXXX")
  rmdir "$candidate"
  python3 "$base/prepare-frontend.py" "$release/public" "$candidate" "$revision"
  chmod -R a+rX "$candidate"
  # Repeated deployment reuses an identical snapshot. Never overwrite an immutable path.
  if [[ -e $new_front || -L $new_front ]]; then
    [[ -d $new_front && ! -L $new_front ]] && diff -qr "$candidate" "$new_front" >/dev/null || { echo 'Existing immutable frontend differs from candidate' >&2; return 1; }
    rm -rf "$candidate"
  else
    mv "$candidate" "$new_front"
  fi
  candidate=
  if [[ $mode == backend ]]; then
    cd "$release"
    export npm_config_registry=https://registry.npmmirror.com
    if ! npm ci --omit=dev --no-audit --no-fund; then
      npm_config_registry=https://registry.npmjs.org npm ci --omit=dev --no-audit --no-fund
    fi
    printf '%s\n' "$revision" > "$release/.deployed-revision"
    cp "$base/bt-start.sh" "$release/deploy/bt-start.sh"
    chown -R www:www "$release"
  fi
  # A durable marker also detects SIGKILL/power loss, which traps cannot recover.
  printf '%s\n%s\n' "$previous_front" "$previous" > "$base/deploy.pending"
  transaction_started=1
  if [[ $mode == backend ]]; then
    backend_touched=1
    panel stop
    wait_free
    switch_backend "$release"
    panel start
    healthy
  fi
  switch_front "$new_front"
  verify_front "$new_front"
  rm -f "$base/deploy.pending"
  committed=1
  echo "$mode deployed $revision"
}

configure_deployment() {
  local node_bin=${SYNCONYM_NODE_BIN_DIR-/www/server/nodejs/v20.19.2/bin}
  export PATH=$node_bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
  base=${SYNCONYM_DEPLOY_BASE-/opt/synconym-deploy}
  live=${SYNCONYM_LIVE_DIR-/www/wwwroot/synconym}
  front=$base/frontend-current
  assets=$base/frontend
  releases=$base/releases
}

deploy_main() {
  set -Eeuo pipefail
  umask 077
  local command=${SSH_ORIGINAL_COMMAND:-}
  # Validate before filesystem side effects. Do not eval SSH_ORIGINAL_COMMAND.
  if [[ $command != status && ! $command =~ ^deploy\ (frontend|backend)\ ([0-9a-f]{40})\ ([0-9a-f]{64})\ ([0-9a-f]{40})\ ([0-9a-f]{40})$ ]]; then
    echo 'Invalid deploy command' >&2; return 2
  fi
  local mode=${BASH_REMATCH[1]:-} revision=${BASH_REMATCH[2]:-} checksum=${BASH_REMATCH[3]:-}
  local expected_front=${BASH_REMATCH[4]:-} expected_backend=${BASH_REMATCH[5]:-}
  configure_deployment
  mkdir -p "$releases" "$assets"
  exec 9>"$base/deploy.lock"
  flock -w 600 9 || { echo 'Deployment is locked' >&2; return 1; }
  chmod 755 "$base" "$assets" "$releases"
  [[ ! -e $base/deploy.pending ]] || { echo 'Incomplete deployment; administrator recovery required' >&2; return 1; }
  previous_front=$(managed_target "$front" "$assets") || { echo 'Frontend is not initialized' >&2; return 1; }
  previous=$(managed_target "$live" "$releases") || { echo 'Live release is not managed' >&2; return 1; }
  local current_front current_backend
  current_front=$(read_revision "$previous_front") || return 1
  current_backend=$(read_revision "$previous") || return 1
  if [[ $command == status ]]; then
    printf '%s %s\n' "$current_front" "$current_backend"; return
  fi
  [[ $current_front == "$expected_front" && $current_backend == "$expected_backend" ]] || { echo 'Live revision changed; retry deployment' >&2; return 1; }
  deploy_release
}

if [[ ${BASH_SOURCE[0]} == "$0" ]]; then
  if [[ ${1:-} == --classify && $# == 4 && -z ${SSH_ORIGINAL_COMMAND:-} ]]; then
    set -Eeuo pipefail
    classify_deployment "$2" "$3" "$4"
  elif (( $# == 0 )); then
    deploy_main
  else
    echo 'Usage: github-deploy.sh --classify FRONTEND BACKEND TARGET' >&2
    exit 2
  fi
fi
