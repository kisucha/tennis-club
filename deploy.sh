#!/usr/bin/env bash
# deploy.sh — 서버에서 최신 코드를 받아 재시작하는 배포 스크립트
# 사용법: bash deploy.sh
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$APP_DIR"

echo "[1/3] git pull origin master ..."
git pull origin master

echo "[2/3] npm install --omit=dev ..."
npm install --omit=dev

echo "[3/3] pm2 reload tennis-club ..."
pm2 reload tennis-club --update-env

echo "배포 완료."
