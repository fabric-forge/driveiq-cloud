// DriveIQ Cloud — Worker environment bindings
// Typed interface for everything injected by the Cloudflare runtime.
// Phase 1: D1 only. Qdrant/OpenAI (Phase 2) and R2 (Phase 3) land here when
// those phases start — see MIGRATION_PLAN.md.

export interface Env {
	DB: D1Database;
}
