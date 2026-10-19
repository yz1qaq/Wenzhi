#!/bin/zsh
# 直接使用默认浏览器打开离线题库，不启动服务器，也不需要安装依赖。
atlas_directory="$(cd "$(dirname "$0")" && pwd)"
open "$atlas_directory/index.html"
