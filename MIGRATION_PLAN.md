# DriveIQ → Cloudflare replatform: migration plan

Status: **CONFIRMED — all 4 open decisions signed off by Ryan on 2026-07-25.
Ready for Phase 1 scaffolding.**
Source: `HANDOFF-driveiq-subdomain.md` (in the reference `DriveIQ` checkout).
Reference patterns confirmed against `social` / `social-ui` (see citations below).

## Goal

`driveiq.ry-ops.dev` live on Cloudflare's serverless stack, same account/zone as
`social.ry-ops.dev`. Two new repos: `fabric-forge/driveiq-cloud` (backend, this
repo) and `fabric-forge/driveiq-ui` (frontend). **Created, not yet coded** —
see "Status" below. The existing `ry-ops/DriveIQ` Docker product is untouched,
read-only reference.

## Status as of this plan

- `fabric-forge/driveiq-cloud` and `fabric-forge/driveiq-ui` — created
  (private), cloned to `/Users/ryandahlberg/Projects/driveiq-cloud` and
  `/Users/ryandahlberg/Projects/driveiq-ui`. Both empty.
- No migration code written yet.

## Confirmed deploy topology (verified against social/social-ui, not assumed)

| Piece | Prod host | Mechanism |
|---|---|---|
| `driveiq-ui` | `driveiq.ry-ops.dev` | **Cloudflare Pages**, not Worker static assets. `social-ui/wrangler.toml` uses `pages_build_output_dir = "dist"`; deployed via GH Actions (`cloudflare/pages-action`) on push to `main`. |
| `driveiq-cloud` | `driveiq-api.ry-ops.dev` | Hono Worker, `wrangler deploy` from a GH Actions job. Custom domain via `routes: [{ pattern, zone_name }]` in `wrangler.jsonc` (social does NOT use `custom_domains`). |

Single API host, no split needed beyond the one above — DriveIQ has no OAuth
callback requiring a dedicated host (unlike social's LinkedIn/YouTube redirect
URIs), so `driveiq-api.ry-ops.dev` alone covers it.

This corrects an ambiguity in the original handoff, which floated "Pages vs.
Worker static assets" as unresolved — it's Pages, confirmed from
`social-ui/README.md`'s own "Deploy topology" table and its GH Actions workflow.

**Frontend/backend boundary**: the UI never proxies through the Worker for
`/api` — `VITE_API_URL` is baked in at Pages build time and every call goes to
the absolute API host. `social-ui/README.md` flags this explicitly: "Relative
`/api` calls will 405 on Pages." `driveiq-ui` needs the same pattern (a
`VITE_API_URL` pointing at the driveiq API host, no relative fetches).

## Backend patterns to mirror (from `social/src/`)

- **Redis**: `@upstash/redis` (HTTP REST), wrapped in a hand-rolled
  `RedisFacade` (`social/src/core/redis.ts`) that mimics the old `ioredis`
  call signatures. Built for a real reason: a persistent-TCP `ioredis` client
  broke on Workers after the first command (no sustained sockets). Port the
  facade pattern, not a raw Redis client.
- **Qdrant**: no SDK — plain `fetch` against the REST API
  (`social/src/core/qdrant.ts`, `qdrantFetch` helper + api-key header).
- **Embeddings**: plain `fetch` to the provider's REST endpoint, no SDK
  (OpenAI in social's case).
- **R2**: bound in `wrangler.jsonc` (`r2_buckets`), read via `c.env.<binding>`
  in route handlers. **Note**: social's own R2 route (`youtube.ts`) has no
  visible auth wrapper around bucket reads — that's fine for social's public
  MP4s but is **not** a pattern to copy as-is for DriveIQ's R2 bucket, which
  holds real PI (CARFAX PDFs, owner's manual). Auth needs to be deliberately
  added, not inherited.
- **Subrequest budget (ADR-009)** — real constraint, already caused a prod
  incident (a `redis.get`-per-item loop blew the free-tier 50-subrequest cap
  and silently broke scheduled publishing). Applies directly to any DriveIQ
  list endpoint (maintenance records, reminders): use `mget`/batch reads,
  never a per-item loop; cap any future bulk/dispatch-style handler.

## The 4 decisions — CONFIRMED 2026-07-25

I read the actual DriveIQ backend code (not just CLAUDE.md) to ground these.
All four recommendations below were confirmed by Ryan as-is.

### 1. D1 vs. managed Postgres+Hyperdrive → **D1** — CONFIRMED

Checked `backend/app/models/{vehicle,maintenance,reminder}.py`: all columns
are plain scalars (`Integer`, `String`, `Date`, `DateTime`, `Float`,
`Boolean`, `Text`) — no Postgres-specific types (no `ARRAY`, no `JSONB`).
Fields that hold structured data (`parts_used`, `documents`, `photos` on
`MaintenanceRecord`) are already stored as JSON-encoded strings in `Text`
columns, not native arrays. This is a clean SQLite/D1 fit as-is.

Also checked `backend/app/services/vector_search.py`: it supports **both**
pgvector and Qdrant backends, but `use_qdrant` defaults to `False` and nothing
in the codebase flips it — pgvector has been the de facto backend. This
matters because it means **no data is "trapped" needing SQL-level vector
queries** — the target architecture puts embeddings in Qdrant regardless of
which backend DriveIQ used historically, so there's no vector-query
requirement pulling toward Hyperdrive. D1 holds the small relational tables
(vehicle, maintenance, reminders); Qdrant holds all vector search. No
Postgres dependency needed.

### 2. Embedding provider → **OpenAI `text-embedding-3-small`** — CONFIRMED

`social` already has this exact provider wired, billed, and proven on
Workers (`social/src/core/qdrant.ts` → `embed()`). Reusing it means zero new
billing setup and a copy-pasteable helper. Full re-embedding is required
either way — DriveIQ's `sentence-transformers` vectors are 384-dim (see
`CLAUDE.md`), OpenAI's model is 1536-dim, so this is a from-scratch Qdrant
collection, not a migration of existing vectors.

### 3. Auth model → **Cloudflare Access, not a ported JWT system** — CONFIRMED

Checked `backend/app/core/security.py`: there is no `User` database model.
Auth is a module-level `USERS = {}` Python dict, seeded on every process
start by `init_default_user()` with a **single hardcoded account**
(`admin` / `driveiq2024`, in plaintext in source). It's already
single-user in practice — the JWT/bcrypt machinery is real but the "multi-user"
surface (`/register`) writes to a dict that's wiped on every restart, so no
registered user has ever actually persisted across a deploy.

**Cloudflare Access in front of the Worker and Pages**, restricted to Ryan's
account. This deletes the entire auth surface (JWT signing, bcrypt,
login/register endpoints, `SECRET_KEY` management) instead of porting a system
that was never real multi-user auth to begin with. Also resolves the
hardcoded-credential issue by removal rather than by porting it forward.

### 4. Full rewrite vs. phased migration → **phased, 3 phases** — CONFIRMED

Given the scope (Python→TS rewrite + 3 storage migrations + embedding
re-generation + auth swap), recommend:

- **Phase 1 — read-only core**: Worker + D1 schema + vehicle/maintenance/
  reminders CRUD (mirrors `backend/app/api/{vehicle,maintenance,reminders}.py`)
  + `driveiq-ui` served on Pages behind Cloudflare Access. No chat/RAG yet.
  This alone gets `driveiq.ry-ops.dev` live, which is the literal ask.
- **Phase 2 — RAG**: Qdrant collection + OpenAI embeddings + re-ingest the
  owner's manual/CARFAX docs (`scripts/ingest_documents.py` logic, ported) +
  `/api/search` and `/api/search/ask`.
  R2 for the source PDFs, with auth-gated routes (see R2 note above).
- **Phase 3 — everything else**: CARFAX import flow, MoE routing
  (`/api/moe/ask`), uploads/photos. MCP server (`mcp/server.py`) stays a
  local dev tool per the handoff — not ported to the Worker unless you decide
  otherwise.

Each phase ships and is checked against the real site before the next starts,
rather than one large PR.

## Next step

All 4 decisions are locked. Phase 1 scaffolding starts next:
- `driveiq-cloud`: `wrangler.jsonc` (Worker name, D1 binding, routes for
  `driveiq-api.ry-ops.dev`, Access-gated), D1 schema migration for
  vehicle/maintenance/reminders, Hono route skeleton mirroring
  `backend/app/api/{vehicle,maintenance,reminders}.py`.
- `driveiq-ui`: Vite scaffold mirroring `social-ui`'s structure, Pages config
  (`wrangler.toml` with `pages_build_output_dir`), `VITE_API_URL` pointed at
  `driveiq-api.ry-ops.dev`, GH Actions deploy workflow copied from
  `social-ui/.github/workflows/deploy.yml`.
- DNS/Access/zone config in the `ry-ops.dev` Cloudflare account (manual step,
  needs Ryan's Cloudflare access — not something to script blind).
