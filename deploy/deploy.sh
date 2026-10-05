#!/usr/bin/env bash
# Sync the repo to the VPS, build there, restart services.
# First time on the server: sudo useradd -r -m -d /opt/ebb ebb; copy env.*.example to /opt/ebb/.env.api / .env.web;
# install ebb-*.service into /etc/systemd/system and nginx-ebb.conf into /etc/nginx/sites-enabled; certbot --nginx.
set -euo pipefail
HOST=${HOST:-saltbound}
DEST=/opt/ebb
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

rsync -az --delete \
  --exclude node_modules --exclude .next --exclude dist --exclude data \
  --exclude 'contracts/out' --exclude 'contracts/cache' --exclude 'contracts/lib' --exclude '.env*' --exclude .secrets --exclude .assets --exclude .claude --exclude .npm-lock --exclude 'apps/web/.next-check' \
  "$ROOT/" "$HOST:$DEST/"

ssh "$HOST" "set -e; cd $DEST && npm ci && \
  npm run build -w @ebb/shared && npm run build -w @ebb/api && \
  set -a && . $DEST/.env.web && set +a && npm run build -w @ebb/web && \
  mkdir -p services/api/data && chown -R ebb:ebb $DEST && \
  systemctl restart ebb-api ebb-web && systemctl --no-pager status ebb-api ebb-web | head -20"
