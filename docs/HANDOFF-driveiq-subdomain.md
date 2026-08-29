# Handoff: get DriveIQ live at driveiq.ry-ops.dev — new repos, no Docker

## Goal
Make DriveIQ reachable at `driveiq.ry-ops.dev`, on the same Cloudflare
account/zone that already serves `social.ry-ops.dev` / `social-api.ry-ops.dev`.
**Docker is explicitly out** — do not propose docker-compose-on-a-VM, a
Cloudflare Tunnel to a home server, or anything that keeps the containers as
containers. The target is Cloudflare's serverless stack (Workers + managed
data services), the same pattern `social` already runs in production.

## Repo strategy — decided, don't relitigate
This is landing in **two new repos**, mirroring the existing `social` /
`social-ui` split:
- **`fabric-forge/driveiq-cloud`** — the new Hono/Workers backend (mirrors
  `social`'s role). Clone/create at `/Users/ryandahlberg/Projects/driveiq-cloud`.
- **`fabric-forge/driveiq-ui`** — the frontend (mirrors `social-ui`'s role).
  Clone/create at `/Users/ryandahlberg/Projects/driveiq-ui`.
- Both **private**, in the `fabric-forge` org (same org that already houses
  `social`, `social-ui`, `blog`, etc.) — not under the personal `ry-ops`
  account.
- **`ry-ops/DriveIQ` (the existing Docker repo) is not touched.** It stays
  exactly as-is — Docker Compose, FastAPI, the Docker Desktop Extension in
  `docker-extension/`, all of it. It's a different product (self-hosted,
  Docker-first) and keeps serving that purpose. Treat it as **read-only
  reference material** to port logic *from*, not a repo to edit or migrate.
  First step: `gh repo create fabric-forge/driveiq-cloud --private` and
  `gh repo create fabric-forge/driveiq-ui --private` (confirm they don't
  already exist first — they didn't as of this handoff).

## Current state — read before doing anything
- Reference repo (read-only source of truth for existing behavior):
  `/Users/ryandahlberg/Projects/DriveIQ` — local `github.com/ry-ops/DriveIQ`
  checkout. Note: **this local folder currently has no `.git` directory** even
  though the GitHub repo has 171 commits and is actively maintained
  (dependabot + a `git-steer` bot auto-merging security patches, last pushed
  2026-07-01). That's a pre-existing quirk of this checkout, not something to
  fix as part of this task — just don't `git init` a new history into it or
  push anything from it. Read the files in place; if you need real git history
  from the reference project, `git clone https://github.com/ry-ops/DriveIQ`
  into a scratch location instead.
- Read `/Users/ryandahlberg/Projects/DriveIQ/CLAUDE.md` for the full existing
  architecture — it's accurate as of last check. Also skim
  `/Users/ryandahlberg/Projects/social/CLAUDE.md` for the target pattern: that
  project runs as a Hono app on Cloudflare Workers, uses Upstash Redis (HTTP
  REST, not a Redis server) and Qdrant Cloud, has no dedicated VM/k3s, deploys
  via `wrangler`, and documents its own subrequest-budget constraints (ADR-009)
  that will matter here too. If it helps to see the actual social/social-ui
  boundary (what lives in the Worker repo vs. the frontend repo, and how the
  frontend actually gets served at its custom domain — Workers static assets
  vs. Cloudflare Pages), check `/Users/ryandahlberg/Projects/social-ui` and
  `social`'s `wrangler.jsonc` directly rather than assuming.

## Current DriveIQ stack (Docker-based — being replaced, not ported as-is)
- **Frontend**: React + TypeScript + Vite + Tailwind (`frontend/`), built as
  static files, currently served via nginx.
- **Backend**: FastAPI / Python 3.11 (`backend/app/`), routes in
  `backend/app/api/` (auth, vehicle, maintenance, reminders, search, chat,
  moe, import_data, uploads, pages). SQLAlchemy ORM models
  (`backend/app/models/`), Pydantic schemas.
- **Relational DB**: PostgreSQL + pgvector extension (vehicle, maintenance
  records, reminders, AND vector-embedded document chunks all in one Postgres).
- **Cache**: Redis (sessions, rate limiting, embedding cache) —
  `backend/app/core/redis_client.py`.
- **Vector search**: Qdrant (`backend/app/core/qdrant_client.py`) — actually
  used in parallel with pgvector; check which one is authoritative before
  assuming both are needed going forward.
- **Embeddings**: `sentence-transformers` running **locally in-process**
  (torch + transformers, in `requirements.txt`) — this is the single biggest
  incompatibility with Workers. There is no way to run PyTorch model inference
  inside a Cloudflare Worker.
- **AI/RAG**: Anthropic Claude API, with an optional local-LLM mode via Docker
  Model Runner (GPU-dependent) — the local-LLM mode is Docker-only by
  definition and should simply be dropped in the serverless version.
- **File storage**: `uploads/`, `docs/` (CARFAX PDFs, vehicle owner manual —
  **contains real PI data, gitignored**), `page_images/` — all local disk
  paths the FastAPI backend reads/writes directly. Workers have no local
  filesystem.
- **MCP server**: `mcp/server.py`, Python stdio, 10 tools for Claude Desktop.
  This is a local dev tool, not part of the public site — out of scope for
  the subdomain work unless you decide otherwise.

## The hard part: this is a backend replatform, not a deploy
Cloudflare Workers only run JS/TS/Wasm — there is no way to lift the FastAPI/
Python backend over as-is (Python Workers exist in beta via Pyodide but don't
support arbitrary C-extension packages like `psycopg2`, `torch`, or
`sentence-transformers`, and don't hold persistent TCP connections to
Postgres). Getting `driveiq.ry-ops.dev` live the way `social.ry-ops.dev` is
live means **rewriting the backend in TypeScript on Hono/Workers**, mirroring
`social`'s `src/worker/` structure. Treat this as a real migration project,
not a config change. Suggested component mapping (validate against what
`social` already proved works, don't take this as gospel — confirm with Ryan
before committing to it):

| DriveIQ today (Docker) | Proposed replacement (serverless, no Docker) |
|---|---|
| FastAPI / Python backend | Hono on Cloudflare Workers (TypeScript) — mirror `social/src/worker/` |
| Postgres + pgvector (relational data) | Cloudflare D1 (SQLite) for vehicle/maintenance/reminder tables — **or** a managed Postgres (Neon/Supabase, which support pgvector) reached via Cloudflare Hyperdrive if you want to keep SQL-level vector queries. This is an open decision — see below. |
| Qdrant (vector search) | Qdrant Cloud (same instance pattern as `social`'s `580002f2-...aws.cloud.qdrant.io` cluster, or a new dedicated collection/cluster — check free-tier capacity before reusing `social`'s) |
| Redis (sessions/cache/rate-limit) | Upstash Redis via REST, same client pattern as `social/src/core/redis.ts` |
| `sentence-transformers` local embeddings | An API-based embedding provider — Cloudflare Workers AI embedding models, or OpenAI `text-embedding-3-small` (already used by `social`, so the account/billing path is proven). Note: **embedding dimensionality changes** (sentence-transformers models here are 384-dim per `CLAUDE.md`; OpenAI's `text-embedding-3-small` is 1536-dim like `social` uses) — any existing Qdrant vectors need re-embedding, not just re-pointing. |
| Docker Model Runner (local LLM) | Drop entirely — cloud-only Anthropic Claude for RAG, same as `social` |
| Local disk (`uploads/`, `docs/`, `page_images/`) | Cloudflare R2 — `social` already has an R2 binding precedent (Short MP4 preview). **This data includes real PI (CARFAX PDFs, owner's manual) — make sure the R2 bucket and any serving routes require auth, not public access.** |
| nginx serving built frontend | Whatever `driveiq-ui` should deploy as, matching how `social-ui` is actually served at `social.ry-ops.dev` today (Cloudflare Pages vs. Worker static assets bound to the `social` Worker — verify by inspecting `social`/`social-ui`'s actual config, don't assume) |
| `docker-extension/` (Docker Desktop Extension) | Not ported — that's specific to the Docker-based `ry-ops/DriveIQ` product and has no equivalent in a Workers-hosted service |

## Open decisions to resolve WITH Ryan before writing code
Don't guess on these — ask, the same way this handoff itself got clarified:
1. **D1 vs. managed Postgres+Hyperdrive** for relational data. D1 is simpler
   and matches `social`'s zero-footprint philosophy, but means porting the
   SQLAlchemy schema to D1/SQL and rewriting queries in TS. Hyperdrive keeps
   more of the existing schema/logic shape but adds an external Postgres
   vendor dependency `social` doesn't have.
2. **Embedding provider** (Workers AI vs. OpenAI) — cost and quality tradeoff,
   plus the re-embedding work either way.
3. **Auth model** — DriveIQ's `backend/app/core/security.py` +
   `backend/app/api/auth.py` currently do JWT (PyJWT) + bcrypt via FastAPI.
   Decide whether this is single-user (Ryan only, in which case Cloudflare
   Access in front of the Worker might be simpler than porting a full auth
   system) or needs to stay a real multi-user login.
4. **Is this a full rewrite in one PR, or a phased migration** (e.g., stand up
   the Worker + D1/Qdrant + frontend first for read-only vehicle/maintenance
   views, migrate chat/RAG once embeddings are sorted)? Given the scope,
   recommend proposing a phased plan and getting sign-off before implementing.

## DNS / deploy mechanics (once the backend exists)
Same Cloudflare account and `ry-ops.dev` zone that `social` uses:
- Add `driveiq.ry-ops.dev` (frontend) and, if a separate API host is warranted
  the way `social-api.ry-ops.dev` is split out from `social.ry-ops.dev`,
  `driveiq-api.ry-ops.dev` — check whether OAuth or any callback-style flow
  actually needs the split before assuming you need two hosts; DriveIQ may
  not need it at all (it has no third-party OAuth today).
- Wire the custom domain via `wrangler.jsonc` routes/custom_domains in
  `driveiq-cloud`, same as `social`'s `wrangler.jsonc` — this is a from-scratch
  setup (brand new repo, no existing config), not an edit.

## First deliverable
Don't start writing migration code immediately. First:
1. Create the two repos (`gh repo create fabric-forge/driveiq-cloud --private`,
   `gh repo create fabric-forge/driveiq-ui --private`), cloned to
   `/Users/ryandahlberg/Projects/driveiq-cloud` and
   `/Users/ryandahlberg/Projects/driveiq-ui`.
2. Produce a short plan — component mapping confirmed, the 4 open decisions
   above resolved, rough phase breakdown — and confirm it with Ryan, given how
   large this replatform is relative to the original ask.
