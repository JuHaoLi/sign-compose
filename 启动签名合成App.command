#!/bin/bash
# 人工签名合成 App · 双击快速启动
cd "$(dirname "$0")/sign-compose-app" || { echo "找不到 sign-compose-app 目录"; read -r; exit 1; }
echo "正在启动 人工签名合成 App ..."
npm start
