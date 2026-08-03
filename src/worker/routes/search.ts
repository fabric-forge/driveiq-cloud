// Aiana — semantic search + RAG Q&A over the owner's manual, QRG, CARFAX
// report, and maintenance audit. Ports the shape of backend/app/api/search.py
// (reference DriveIQ/FastAPI), scoped to Qdrant-only semantic search per
// MIGRATION_PLAN.md Phase 2 (no hybrid keyword search, no page-image
// thumbnails/highlighting — those depend on features not ported).

import { Hono } from 'hono';
import type { Env } from '../env.js';
import { searchDocuments, collectionInfo, embedBatch, upsertChunks, ensureCollection } from '../core/qdrant.js';
import { generateWithTools, extractText, type AnthropicTool, type LLMMessage } from '../core/anthropic.js';
import { buildServiceStatus, formatServiceStatusTable, type MaintenanceRecordRow } from '../core/maintenanceSchedule.js';

// Lets the owner tell Aiana about a scheduled appointment in plain
// conversation ("I have an oil change booked for 9/15 at Kari Toyota")
// instead of using the reminder form. Tagged category='appointment' so
// driveiq-ui's "Ask Aiana" deep link / spec preview skips these — there's no
// manual page to look up for an appointment, only for a part or fluid.
const CREATE_REMINDER_TOOL: AnthropicTool = {
	name: 'create_reminder',
	description:
		"Add an upcoming service appointment to the owner's \"What's Next\" list. Only call this when the owner is describing an actual scheduled or planned appointment (a specific date and/or mileage), not when they're just asking a general maintenance question. If they mention wanting to schedule something but haven't given you a date or mileage yet, ask them for one in your reply instead of calling this tool.",
	input_schema: {
		type: 'object',
		properties: {
			title: { type: 'string', description: 'Short title, e.g. "Oil Change" or "Tire Rotation at Kari Toyota"' },
			due_date: { type: 'string', description: 'ISO date (YYYY-MM-DD) the appointment is scheduled for, if known' },
			due_mileage: { type: 'number', description: 'Mileage the appointment is tied to, if the owner mentioned one' },
			description: { type: 'string', description: "Any extra detail the owner mentioned (location, reason, provider), if any" },
		},
		required: ['title'],
	},
};

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

	// Manual/document RAG search — optional. A collection that doesn't exist
	// yet or a query with no relevant chunks shouldn't block answering
	// service-history questions ("when was my last oil change?"), which need
	// no document context at all.
	const info = await collectionInfo(c.env);
	const results = info && info.points_count > 0 ? await searchDocuments(c.env, body.query, 5, 0.35) : [];

	const docContext = results.length
		? results.map((r) => `[${r.document_name}${r.page_number ? `, p.${r.page_number}` : ''}]\n${r.content}`).join('\n\n---\n\n')
		: null;

	const vehicle = await c.env.DB.prepare('SELECT * FROM vehicles LIMIT 1').first<{
		id: number;
		year: number;
		make: string;
		model: string;
		trim: string | null;
		vin: string;
		current_mileage: number | null;
	}>();

	// Service history — always fetched, so Aiana can answer "when was my last
	// X" and "when is my next X due" for every maintenance type on file, not
	// just what's in the owner's manual.
	const { results: records } = vehicle
		? await c.env.DB.prepare(
				'SELECT maintenance_type, date_performed, mileage FROM maintenance_records WHERE vehicle_id = ? ORDER BY date_performed DESC'
			)
				.bind(vehicle.id)
				.all<MaintenanceRecordRow>()
		: { results: [] as MaintenanceRecordRow[] };

	const serviceHistoryContext =
		records.length > 0
			? `Service history for this vehicle (current odometer: ${vehicle?.current_mileage?.toLocaleString() ?? 'unknown'} mi). "Next Due" is projected from the manufacturer-recommended interval after the last time that service was performed — use it to tell the owner when their next service of that type is due.\n\n${formatServiceStatusTable(buildServiceStatus(records, vehicle?.current_mileage ?? null))}`
			: null;

	// NHTSA recalls — fetched from the structured table, not left to RAG
	// retrieval over the ingested VIN-report PDF. Semantic search only
	// returns its top-K most relevant chunks, so a broad question like "how
	// many recalls are there" was silently undercounting (missing whichever
	// campaigns didn't make the top 5). This table is the exact, complete
	// list every time.
	const { results: recalls } = vehicle
		? await c.env.DB.prepare(
				'SELECT nhtsa_campaign, component, summary, remedy, report_receipt_date, status FROM recalls WHERE vehicle_id = ? ORDER BY report_receipt_date DESC'
			)
				.bind(vehicle.id)
				.all<{
					nhtsa_campaign: string;
					component: string;
					summary: string;
					remedy: string | null;
					report_receipt_date: string | null;
					status: string;
				}>()
		: { results: [] };

	const recallsContext =
		recalls.length > 0
			? `NHTSA recalls on file for this VIN (${recalls.length} total). This is the complete, authoritative list — not a partial search result.\n\n${recalls
					.map(
						(r) =>
							`- ${r.nhtsa_campaign} (${r.component}), reported ${r.report_receipt_date ?? 'unknown date'}, status: ${r.status}\n  ${r.summary}${r.remedy ? `\n  Remedy: ${r.remedy}` : ''}`
					)
					.join('\n')}`
			: null;

	if (!docContext && !serviceHistoryContext && !recallsContext) {
		return c.json({
			answer:
				"I couldn't find relevant information in your vehicle documentation or service history for this question. Try rephrasing, or consult your owner's manual directly.",
			sources: [],
		});
	}

	const vehicleLine = vehicle
		? `You help answer questions about a ${vehicle.year} ${vehicle.make} ${vehicle.model} ${vehicle.trim ?? ''}.\nVIN: ${vehicle.vin}`
		: 'You help answer questions about the owner\'s vehicle.';

	const system = `You are Aiana, an intelligent assistant for vehicle owners.
${vehicleLine}

Answer using the provided documentation, service history table, and/or recalls list below, whichever is relevant to the question. Be concise, practical, and safety-focused.
When asked about a past service (e.g. "when was my last oil change"), answer from the service history table, then proactively add when the *next* one of that same service is due (mileage and/or estimated date) using the "Next Due" columns — don't make the owner ask a second question for that.
If a service has never been logged ("Never logged" status), say so plainly rather than guessing a date.
When asked about recalls (e.g. "how many recalls", "is there an open recall"), always answer from the NHTSA recalls list below, never from a CARFAX report's own "no open recalls reported to CARFAX" line — CARFAX's recall data feed is separate from NHTSA's and is frequently incomplete or stale, so that specific claim must be ignored even if it's the retrieved documentation's most relevant-looking match. The NHTSA recalls list is the complete, exact set for this VIN; if it's absent from the context below, say recall data isn't available rather than trusting a CARFAX summary line.
If neither source fully answers the question, say what you found and suggest checking the full manual or logging the service.
If the owner describes a scheduled or planned service appointment (a specific date and/or mileage), use the create_reminder tool to add it for them — don't just say you will, actually call the tool.`;

	const contextParts = [
		// Recalls and service history first — these are exact, structured facts
		// that should win over anything semantically similar retrieved from
		// document RAG (e.g. a CARFAX report's own "no open recalls reported to
		// CARFAX" boilerplate, which is a different, less complete data source
		// than the NHTSA recalls list and has previously caused the model to
		// answer from the wrong source when doc context also mentions recalls).
		recallsContext,
		serviceHistoryContext,
		docContext ? `Context from vehicle documentation:\n${docContext}` : null,
	].filter((p): p is string => p !== null);

	const messages: LLMMessage[] = [{ role: 'user', content: `${contextParts.join('\n\n---\n\n')}\n\nQuestion: ${body.query}` }];

	const first = await generateWithTools(c.env, { system, messages, tools: [CREATE_REMINDER_TOOL], maxTokens: 600 });

	const toolUse = first.content.find((b) => b.type === 'tool_use' && b.name === 'create_reminder');
	let answer: string;
	let reminderCreated = false;

	if (first.stop_reason === 'tool_use' && toolUse) {
		const input = toolUse.input as { title: string; due_date?: string; due_mileage?: number; description?: string };
		const reminderType = input.due_date && input.due_mileage ? 'both' : input.due_mileage ? 'mileage' : 'date';

		if (vehicle) {
			await c.env.DB.prepare(
				`INSERT INTO reminders (vehicle_id, title, description, reminder_type, due_date, due_mileage, category, notify_days_before, notify_miles_before)
				 VALUES (?, ?, ?, ?, ?, ?, 'appointment', 7, 500)`
			)
				.bind(vehicle.id, input.title, input.description ?? null, reminderType, input.due_date ?? null, input.due_mileage ?? null)
				.run();
			reminderCreated = true;
		}

		const toolResultText = reminderCreated
			? `Added "${input.title}" to the owner's What's Next list.`
			: 'Could not add the reminder — no vehicle on record.';

		const followup = await generateWithTools(c.env, {
			system,
			messages: [
				...messages,
				{ role: 'assistant', content: first.content },
				{ role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUse.id!, content: toolResultText }] },
			],
			tools: [CREATE_REMINDER_TOOL],
			maxTokens: 300,
		});
		answer = extractText(followup.content);
	} else {
		answer = extractText(first.content);
	}

	return c.json({
		answer,
		reminder_created: reminderCreated,
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
