#!/usr/bin/env bash
# 前端独立发布脚本：只部署静态文件，不重启 Node 服务。
# 用于仅修改页面、样式、布局的更新，且新版前端与当前运行的后端兼容。
set -Eeuo pipefail

revision=${1:?需要提供 Git SHA}
frontend_base=/opt/synconym-deploy/frontend
frontend_current=/opt/synconym-deploy/frontend-current
releases=/opt/synconym-deploy/releases

# 检查源版本是否存在
if [[ ! -d "$releases/$revision" ]]; then
  echo "错误：版本 $revision 不存在于 $releases" >&2
  exit 1
fi

# 创建前端版本目录
mkdir -p "$frontend_base"
frontend_release="$frontend_base/${revision:0:12}.$(date +%Y%m%d-%H%M%S)"

# 复制 public 目录到新版本目录
echo "正在准备前端版本 $revision..."
cp -r "$releases/$revision/public" "$frontend_release"
chmod -R 755 "$frontend_release"

# 保存发布信息
printf '%s\n' "$revision" > "$frontend_release/.deployed-revision"
date -Iseconds > "$frontend_release/.deployed-at"

# 验证关键文件存在
if [[ ! -f "$frontend_release/index.html" ]]; then
  echo "错误：新版本缺少 index.html" >&2
  rm -rf "$frontend_release"
  exit 1
fi

# 记录切换前的版本（用于回滚）
previous=""
if [[ -L "$frontend_current" ]]; then
  previous=$(readlink -f "$frontend_current")
fi

# 原子切换符号链接
echo "正在切换前端版本..."
ln -s "$frontend_release" "$frontend_base/current.next"
mv -Tf "$frontend_base/current.next" "$frontend_current"

# 验证新版本可访问
echo "正在验证前端可访问性..."
sleep 1
if curl -fsS --max-time 5 http://127.0.0.1/index.html > /dev/null 2>&1; then
  echo "前端部署成功：$revision"
  echo "新版本：$frontend_release"
  [[ -n "$previous" ]] && echo "旧版本（可回滚）：$previous"
  exit 0
else
  echo "错误：新版本验证失败，正在回滚..." >&2
  if [[ -n "$previous" && -d "$previous" ]]; then
    rm -f "$frontend_base/current.next"
    ln -s "$previous" "$frontend_base/current.next"
    mv -Tf "$frontend_base/current.next" "$frontend_current"
    echo "已回滚到：$previous" >&2
  fi
  rm -rf "$frontend_release"
  exit 1
fi
