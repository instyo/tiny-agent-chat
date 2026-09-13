#!/usr/bin/env bash
# Offline fallback: build on this machine and scp to Armbian.
# Preferred path: push to GitHub → Actions → GHCR → docker compose pull on server.
set -euo pipefail

HOST="${DEPLOY_HOST:?set DEPLOY_HOST=user@armbian-ip}"
IMAGE="${IMAGE_NAME:-tiny-agent-chat:latest}"
REMOTE_DIR="${REMOTE_DIR:-/opt/tiny-agent-chat}"
PLATFORM="${PLATFORM:-linux/arm64}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

cd "$ROOT"

echo "==> Building $IMAGE for $PLATFORM"
docker buildx build --platform "$PLATFORM" -t "$IMAGE" --load .

TMP="$(mktemp -t tiny-agent-chat.XXXXXX.tar.gz)"
trap 'rm -f "$TMP"' EXIT

echo "==> Saving image"
docker save "$IMAGE" | gzip > "$TMP"

echo "==> Copying to $HOST:$REMOTE_DIR"
ssh "$HOST" "mkdir -p '$REMOTE_DIR'"
scp "$TMP" "$HOST:$REMOTE_DIR/image.tar.gz"
scp "$ROOT/docker-compose.dev.yml" "$HOST:$REMOTE_DIR/docker-compose.yml"
scp "$ROOT/.env.example" "$HOST:$REMOTE_DIR/.env.example"

echo "==> Loading image on server"
ssh "$HOST" "gunzip -c '$REMOTE_DIR/image.tar.gz' | docker load && rm -f '$REMOTE_DIR/image.tar.gz'"

ssh "$HOST" "test -f '$REMOTE_DIR/.env' || cp '$REMOTE_DIR/.env.example' '$REMOTE_DIR/.env'"
ssh "$HOST" "test -f '$REMOTE_DIR/.env' && grep -q '^OPENAI_API_KEY=.\+' '$REMOTE_DIR/.env' || echo \"WARNING: set OPENAI_API_KEY in $REMOTE_DIR/.env\""

echo
echo "Deployed $IMAGE → $HOST:$REMOTE_DIR"
echo "Run:"
echo "  ssh -t $HOST 'cd $REMOTE_DIR && docker run --rm -it --init --env-file .env -v tiny-agent-data:/app/data $IMAGE'"
echo "Or:"
echo "  ssh -t $HOST 'cd $REMOTE_DIR && docker compose run --rm chat'"
