# tiny-agent-chat

CLI agent chat with Anvia tools + SQLite memory.

Commands: `/exit` `/clear` `/session` `/new`

### Agent tools

- `get_time` — current ISO time
- `calculate` — basic arithmetic
- `get_memory_usage` — process heap/RSS, host free/total, Docker/cgroup limits when present
- `run_command` — restricted allowlisted inspection only (`free`, `ps`, `df`, `uname`, …); no shell pipes
- `web_search` — public web search (Tavily if `TAVILY_API_KEY` is set; else DuckDuckGo → Bing fallback)
- `web_fetch` — fetch a public URL and return plain text (HTML stripped; private/localhost blocked)

## Local (Bun)

```bash
bun install
cp .env.example .env   # set OPENAI_API_KEY
bun start
```

## Deploy flow (GitHub → GHCR → CasaOS)

```
push to main → GitHub Actions builds linux/arm64 → ghcr.io/<you>/tiny-agent-chat
→ CasaOS/Armbian pulls image → SSH + docker exec to chat
```

### 1. GitHub repo

```bash
git init   # if needed
git add .
git commit -m "Initial commit"
# create a private repo on GitHub, then:
git remote add origin git@github.com:instyo/tiny-agent-chat.git
git branch -M main
git push -u origin main
```

### 2. GitHub Actions → GHCR

On every push to `main` (and tags `v*`), [`.github/workflows/docker-publish.yml`](.github/workflows/docker-publish.yml) builds **linux/arm64** and pushes:

- `ghcr.io/<owner>/tiny-agent-chat:latest`
- `ghcr.io/<owner>/tiny-agent-chat:<short-sha>`
- `ghcr.io/<owner>/tiny-agent-chat:<tag>` (on version tags)

After the first successful run:

1. GitHub → your profile/org → **Packages** → `tiny-agent-chat`
2. Package settings → keep **Private** (default for private repos)

No API keys are needed in Actions; secrets stay on the server.

### 3. Armbian / CasaOS one-time setup

**A. Docker login to private GHCR**

Create a GitHub PAT with `read:packages`, then on the server:

```bash
echo YOUR_PAT | docker login ghcr.io -u YOUR_GITHUB_USERNAME --password-stdin
```

**B. App files**

```bash
mkdir -p /DATA/AppData/tiny-agent-chat   # or any path you prefer
cd /DATA/AppData/tiny-agent-chat
# copy docker-compose.yml from the repo, then:
cp .env.example .env
```

Edit `.env`:

```env
IMAGE=ghcr.io/instyo/tiny-agent-chat:latest
OPENAI_API_KEY=sk-...
```

**C. Install**

CasaOS → **Install a customized app** → paste `docker-compose.yml` (ensure `IMAGE` matches), or:

```bash
docker compose pull
docker compose up -d
```

### 4. Chat (SSH)

```bash
docker exec -it tiny-agent-chat bun run src/index.ts
```

On-demand without the keep-alive container:

```bash
docker compose run --rm --entrypoint bun chat run src/index.ts
```

### 5. Updates

After Actions publishes a new `:latest`:

```bash
cd /DATA/AppData/tiny-agent-chat
docker compose pull
docker compose up -d
```

Memory persists in the `chat-data` volume.

---

## Docker (local build)

```bash
docker compose -f docker-compose.dev.yml build
docker compose -f docker-compose.dev.yml run --rm chat
```

Or plain Docker:

```bash
docker build -t tiny-agent-chat:latest .
docker run --rm -it --init --env-file .env -v tiny-agent-data:/app/data tiny-agent-chat:latest
```

## Offline deploy (Mac → Armbian scp)

Fallback if you cannot use GHCR:

```bash
export DEPLOY_HOST=user@armbian-ip
bun run deploy:armbian
```

See `scripts/deploy-armbian.sh`. Prefer the GHCR flow above for day-to-day use.
