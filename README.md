# tiny-agent-chat

CLI agent chat with Anvia tools + SQLite memory.

## Local

```bash
bun install
cp .env.example .env   # set OPENAI_API_KEY
bun start
```

Commands: `/exit` `/clear` `/session` `/new`

## Docker (local)

```bash
docker build -t tiny-agent-chat:latest .
docker run --rm -it --init --env-file .env -v tiny-agent-data:/app/data tiny-agent-chat:latest
```

## Deploy to Armbian (from Mac)

One-time on the server:

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER   # re-login
uname -m   # expect aarch64
```

From this machine:

```bash
export DEPLOY_HOST=user@armbian-ip
bun run deploy:armbian
# then edit /opt/tiny-agent-chat/.env on the server with OPENAI_API_KEY
ssh -t $DEPLOY_HOST 'cd /opt/tiny-agent-chat && docker run --rm -it --init --env-file .env -v tiny-agent-data:/app/data tiny-agent-chat:latest'
```

Optional env overrides: `IMAGE_NAME`, `REMOTE_DIR`, `PLATFORM` (default `linux/arm64`).
