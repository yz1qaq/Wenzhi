#!/bin/zsh
atlas_directory="$(cd "$(dirname "$0")" && pwd)"
cd "$atlas_directory" || exit 1
printf '启动后请打开终端显示的本机地址；Control+C 停止服务。\n'
make run PORT="${WENZHI_PORT:-8765}"
