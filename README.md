# DevSearch

Search official docs, GitHub and Stack Overflow in one place, filter by framework and version, and get an AI answer where every `[n]` cites a retrieved source (or says "not found in sources").

Runs entirely on your machine. Bring your own model key: Claude, OpenAI, Gemini, xAI, Mistral, DeepSeek, OpenRouter, or any OpenAI-compatible server (Ollama, vLLM, LiteLLM).

## Quick start

```bash
npm install -g @aryptn/devsearch
ds
```

`ds` sets everything up on the first run, starts the app and opens http://localhost:3000. Add your model key in **Settings**. The key stays in your browser.

| Command | What it does |
|---|---|
| `ds` | Set up on first run, start, open the browser |
| `ds stop` | Stop the Docker containers |
| `ds help` | Show usage |
| `ds ~/other-folder` | Use a different install folder |

Ctrl-C stops the app. The app lives in `~/devsearch` (or `$DEVSEARCH_HOME`). Your settings are in `~/devsearch/.env`.

No global install? `npx @aryptn/devsearch` does the same.

## Requirements

- [Node.js](https://nodejs.org) 20.12 or newer
- [Docker](https://docs.docker.com/get-docker/), running
- [uv](https://docs.astral.sh/uv/), the Python package manager (it installs Python for you)

### macOS

```bash
brew install node uv
brew install --cask docker     # then open Docker Desktop once
npm install -g @aryptn/devsearch
ds
```

### Linux (Ubuntu / Debian)

```bash
# Node.js 22
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

# Docker
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER  # log out and back in afterwards

# uv
curl -LsSf https://astral.sh/uv/install.sh | sh

npm install -g @aryptn/devsearch
ds
```

On Fedora, Arch and other distros, install `nodejs`, `docker` and `uv` with your package manager.

### Windows (PowerShell)

```powershell
winget install OpenJS.NodeJS.LTS
winget install Docker.DockerDesktop    # then start Docker Desktop
winget install astral-sh.uv
# open a new terminal so PATH updates
npm install -g @aryptn/devsearch
ds
```

If PowerShell blocks `ds.ps1`, run `ds.cmd` or `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.

## Configuration

Edit `~/devsearch/.env`, then run `ds` again. Every setting is optional.

| Setting | Purpose |
|---|---|
| `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, ... | Server-side fallback keys. Not needed if you add keys in Settings. |
| `CUSTOM_OPENAI_BASE_URL` | Any OpenAI-compatible server, for example Ollama at `http://localhost:11434/v1` |
| `<PROVIDER>_MODELS` | Override a provider's model list, for example `OPENAI_MODELS=gpt-6.1-sol` |
| `VOYAGE_API_KEY` | Real semantic embeddings. Without it, a weak local fallback is used. |
| `GITHUB_TOKEN`, `STACK_KEY` | Higher crawl rate limits |
| `POSTGRES_DSN` | Use your own Postgres or Supabase (transaction-pooler URI with `sslmode=require`) |
| `PORT`, `API_PORT` | Environment variables if 3000 or 8000 are taken: `PORT=3001 API_PORT=8002 ds` |

### Load more content

The first run loads a small sample set. To crawl the live sources listed in `workers/run.py`:

```bash
cd ~/devsearch
uv run --env-file .env python -m workers.run
```

## Develop from source

```bash
git clone https://github.com/enigmahacker/devsearch.git
cd devsearch
node bin/devsearch.mjs .        # same as `ds`, run in place
uv run pytest                   # tests
```

Or start each part by hand:

```bash
cp .env.example .env
docker compose up -d --wait                                # Postgres, OpenSearch, Qdrant, Redis
uv sync
uv run --env-file .env python -m workers.run --fixtures    # sample data
uv run --env-file .env uvicorn api.app.main:app --port 8000
npm --prefix web install && npm --prefix web run dev       # http://localhost:3000
```

```
bin/      ds command
web/      Next.js + Tailwind: search page, answer panel, settings
api/      FastAPI: /search, /answer, /filters, /models
workers/  connectors (docs, GitHub, Stack Overflow) -> chunk -> embed -> index
```

## How it works

- **Ranking**: RRF over BM25 and vector search, weighted by source reliability (docs 1.0, GitHub 0.8, Stack Overflow 0.7) and freshness (one-year half-life).
- **Answers**: one model call per question, grounded only in the retrieved sources. Your key is sent with each request and never stored on the server.
- **Limits**: per-IP rate limits in Redis (`RATE_LIMIT_PER_MIN`, `ANSWER_LIMIT_PER_MIN`) and a daily answer cap (`DAILY_ANSWER_CAP`).
- **Sources**: the docs crawler honors `robots.txt` and crawl-delay. Stack Overflow content is CC BY-SA, and every result links its source and authors.

## Troubleshooting

- **`docker not found` or containers fail**: start Docker Desktop (or `sudo systemctl start docker` on Linux), then run `ds` again.
- **Port already in use**: `PORT=3001 API_PORT=8002 ds`.
- **Start over**: `ds stop`, then delete `~/devsearch` and run `ds` again.
