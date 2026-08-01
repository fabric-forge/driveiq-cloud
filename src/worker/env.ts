// DriveIQ Cloud — Worker environment bindings
// Typed interface for everything injected by the Cloudflare runtime.
// Phase 1: D1. Phase 2 (Aiana / RAG): Qdrant + OpenAI + Anthropic secrets.
// R2 (Phase 3) lands here when that phase starts — see MIGRATION_PLAN.md.

export interface Env {
	DB: D1Database;
	AI: Ai;
	QDRANT_COLLECTION: string;
	EMBEDDING_MODEL: string;
	CLAUDE_MODEL: string;
	ANTHROPIC_API_KEY: string;
	QDRANT_URL: string;
	QDRANT_API_KEY: string;
}
