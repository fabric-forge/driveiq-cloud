// Aiana — semantic search + RAG Q&A over the owner's manual, QRG, CARFAX
// report, and maintenance audit. Ports the shape of backend/app/api/search.py
// (reference DriveIQ/FastAPI), scoped to Qdrant-only semantic search per
// MIGRATION_PLAN.md Phase 2 (no hybrid keyword search, no page-image
// thumbnails/highlighting — those depend on features not ported).

import { Hono } from 'hono';
import type { Env } from '../env.js';
import { searchDocuments, collectionInfo, embedBatch, upsertChunks, ensureCollection } from '../core/qdrant.js';
import { generate } from '../core/anthropic.js';

export const searchRoutes = new Hono<{ Bindings: Env }>();

// One-off ingestion endpoint — see scripts/ingest.mjs. Not a general upload
// API (Phase 3 R2/auth-gated uploads are separate); this exists so chunking
// can happen locally (PDF parsing) while embedding happens here, where the
// Workers AI binding actually lives.
searchRoutes.post('/ingest', async (c) => {
	const body = await c.req.json<{
		document_name: string;
		chunks: Array<{ content: string; chunk_index: number; page_number: number | null }>;
	}>();
	if (!body.document_name || !Array.isArray(body.chunks) || body.chunks.length === 0) {
		return c.json({ detail: 'document_name and chunks[] are required' }, 400);
	}

	await ensureCollection(c.env);
	const vectors = await embedBatch(c.env, body.chunks.map((ch) => ch.content));
	await upsertChunks(
		c.env,
		body.chunks.map((ch, i) => ({
			document_name: body.document_name,
			chunk_index: ch.chunk_index,
			content: ch.content,
			page_number: ch.page_number ?? undefined,
			vector: vectors[i],
		}))
	);

	return c.json({ ingested: body.chunks.length });
});

searchRoutes.post('/', async (c) => {
	const body = await c.req.json<{ query: string; limit?: number }>();
	if (!body.query?.trim()) return c.json({ detail: 'query is required' }, 400);

	const info = await collectionInfo(c.env);
	if (!info || info.points_count === 0) {
		return c.json({ detail: 'No documents ingested yet' }, 404);
	}

	const results = await searchDocuments(c.env, body.query, body.limit ?? 5);
	return c.json(results);
});

searchRoutes.post('/ask', async (c) => {
	const body = await c.req.json<{ query: string }>();
	if (!body.query?.trim()) return c.json({ detail: 'query is required' }, 400);

	const info = await collectionInfo(c.env);
	if (!info || info.points_count === 0) {
		return c.json({ detail: 'No documents ingested. Run the ingestion script first.' }, 404);
	}

	const results = await searchDocuments(c.env, body.query, 5, 0.35);

	if (results.length === 0) {
		return c.json({
			answer:
				"I couldn't find relevant information in your vehicle documentation for this question. Try rephrasing, or consult your owner's manual directly.",
			sources: [],
		});
	}

	const context = results
		.map((r) => `[${r.document_name}${r.page_number ? `, p.${r.page_number}` : ''}]\n${r.content}`)
		.join('\n\n---\n\n');

	const vehicle = await c.env.DB.prepare('SELECT * FROM vehicles LIMIT 1').first<{
		year: number;
		make: string;
		model: string;
		trim: string | null;
		vin: string;
	}>();

	const vehicleLine = vehicle
		? `You help answer questions about a ${vehicle.year} ${vehicle.make} ${vehicle.model} ${vehicle.trim ?? ''}.\nVIN: ${vehicle.vin}`
		: 'You help answer questions about the owner\'s vehicle.';

	const system = `You are Aiana, an intelligent assistant for vehicle owners.
${vehicleLine}

Answer based on the provided documentation. Be concise, practical, and safety-focused.
If the documentation doesn't fully answer the question, say what you found and suggest checking the full manual.`;

	const answer = await generate(c.env, {
		system,
		messages: [{ role: 'user', content: `Context from vehicle documentation:\n${context}\n\nQuestion: ${body.query}` }],
		maxTokens: 600,
	});

	return c.json({
		answer,
		sources: results.map((r) => ({
			document: r.document_name,
			page: r.page_number,
			relevance: Math.round(r.score * 100) / 100,
			...(r.page_number
				? {
						thumbnail_url: `/api/pages/${encodeURIComponent(r.document_name)}/${r.page_number}/thumbnail`,
						fullsize_url: `/api/pages/${encodeURIComponent(r.document_name)}/${r.page_number}/full`,
					}
				: {}),
		})),
	});
});
