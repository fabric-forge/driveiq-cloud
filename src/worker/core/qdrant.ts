// DriveIQ Cloud — Qdrant REST client + embeddings
// Mirrors social/src/core/qdrant.ts's qdrantFetch pattern: no SDK, plain
// fetch against the REST API. Embeddings via Cloudflare Workers AI (native
// binding — no separate API key/billing, unlike social's OpenAI-based embed).

import type { Env } from '../env.js';

export interface DocumentChunk {
	document_name: string;
	chunk_index: number;
	content: string;
	page_number?: number;
}

async function qdrantFetch(env: Env, path: string, init?: RequestInit): Promise<unknown> {
	const base = env.QDRANT_URL.replace(/\/$/, '');
	const headers = { 'Content-Type': 'application/json', 'api-key': env.QDRANT_API_KEY };
	const res = await fetch(`${base}${path}`, { ...init, headers: { ...headers, ...init?.headers } });
	if (!res.ok) {
		const body = await res.text().catch(() => '');
		throw new Error(`Qdrant ${init?.method ?? 'GET'} ${path} → ${res.status}: ${body}`);
	}
	return res.json();
}

interface BgeEmbeddingResponse {
	shape: [number, number];
	data: number[][];
}

export async function embed(env: Env, text: string): Promise<number[]> {
	const result = (await env.AI.run(env.EMBEDDING_MODEL as keyof AiModels, { text: [text] })) as BgeEmbeddingResponse;
	return result.data[0];
}

export async function embedBatch(env: Env, texts: string[]): Promise<number[][]> {
	const result = (await env.AI.run(env.EMBEDDING_MODEL as keyof AiModels, { text: texts })) as BgeEmbeddingResponse;
	return result.data;
}

export async function ensureCollection(env: Env, dims = 768): Promise<void> {
	const name = env.QDRANT_COLLECTION;
	const existing = await qdrantFetch(env, `/collections/${name}`).catch(() => null);
	if (existing) return;

	await qdrantFetch(env, `/collections/${name}`, {
		method: 'PUT',
		body: JSON.stringify({
			vectors: { size: dims, distance: 'Cosine' },
			optimizers_config: { default_segment_number: 2 },
		}),
	});

	for (const field of ['document_name']) {
		await qdrantFetch(env, `/collections/${name}/index`, {
			method: 'PUT',
			body: JSON.stringify({ field_name: field, field_schema: 'keyword' }),
		}).catch(() => null);
	}
}

export async function upsertChunks(
	env: Env,
	chunks: Array<DocumentChunk & { vector: number[] }>
): Promise<void> {
	const points = chunks.map((c) => ({
		id: crypto.randomUUID(),
		vector: c.vector,
		payload: {
			document_name: c.document_name,
			chunk_index: c.chunk_index,
			content: c.content,
			page_number: c.page_number ?? null,
		},
	}));

	await qdrantFetch(env, `/collections/${env.QDRANT_COLLECTION}/points`, {
		method: 'PUT',
		body: JSON.stringify({ points }),
	});
}

export interface SearchHit {
	score: number;
	document_name: string;
	chunk_index: number;
	content: string;
	page_number: number | null;
}

export async function searchDocuments(env: Env, query: string, limit = 5, scoreThreshold = 0.3): Promise<SearchHit[]> {
	const vector = await embed(env, query);

	const result = (await qdrantFetch(env, `/collections/${env.QDRANT_COLLECTION}/points/search`, {
		method: 'POST',
		body: JSON.stringify({
			vector,
			limit,
			score_threshold: scoreThreshold,
			with_payload: true,
		}),
	})) as { result: Array<{ score: number; payload: DocumentChunk }> };

	return result.result.map((r) => ({
		score: r.score,
		document_name: r.payload.document_name,
		chunk_index: r.payload.chunk_index,
		content: r.payload.content,
		page_number: r.payload.page_number ?? null,
	}));
}

export async function collectionInfo(env: Env): Promise<{ points_count: number } | null> {
	try {
		const result = (await qdrantFetch(env, `/collections/${env.QDRANT_COLLECTION}`)) as {
			result: { points_count: number };
		};
		return { points_count: result.result.points_count };
	} catch {
		return null;
	}
}
