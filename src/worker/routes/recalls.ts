// NHTSA recall records — see migrations/0005_recalls.sql for why this is a
// plain table instead of another Qdrant document. Populated by
// scripts/seed-recalls.mjs, not by request-time lookups.

import { Hono } from 'hono';
import type { Env } from '../env.js';

export const recallsRoutes = new Hono<{ Bindings: Env }>();

recallsRoutes.get('/', async (c) => {
	const { results } = await c.env.DB.prepare('SELECT * FROM recalls ORDER BY report_receipt_date DESC').all();
	return c.json(results);
});

recallsRoutes.post('/', async (c) => {
	const body = await c.req.json<{
		vehicle_id: number;
		nhtsa_campaign: string;
		component: string;
		summary: string;
		consequence?: string;
		remedy?: string;
		report_receipt_date?: string;
		status?: 'open' | 'remedied';
	}>();
	if (!body.vehicle_id || !body.nhtsa_campaign || !body.component || !body.summary) {
		return c.json({ detail: 'vehicle_id, nhtsa_campaign, component, and summary are required' }, 400);
	}

	const row = await c.env.DB.prepare(
		`INSERT INTO recalls (vehicle_id, nhtsa_campaign, component, summary, consequence, remedy, report_receipt_date, status)
		 VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE(?, 'open'))
		 ON CONFLICT(nhtsa_campaign) DO UPDATE SET
		   component = excluded.component,
		   summary = excluded.summary,
		   consequence = excluded.consequence,
		   remedy = excluded.remedy,
		   report_receipt_date = excluded.report_receipt_date,
		   updated_at = datetime('now')
		 RETURNING *`
	)
		.bind(
			body.vehicle_id,
			body.nhtsa_campaign,
			body.component,
			body.summary,
			body.consequence ?? null,
			body.remedy ?? null,
			body.report_receipt_date ?? null,
			body.status ?? null
		)
		.first();

	return c.json(row, 201);
});

recallsRoutes.patch('/:id{[0-9]+}', async (c) => {
	const id = Number(c.req.param('id'));
	const body = await c.req.json<{ status: 'open' | 'remedied' }>();
	if (body.status !== 'open' && body.status !== 'remedied') {
		return c.json({ detail: "status must be 'open' or 'remedied'" }, 400);
	}

	const row = await c.env.DB.prepare(
		`UPDATE recalls SET status = ?, updated_at = datetime('now') WHERE id = ? RETURNING *`
	)
		.bind(body.status, id)
		.first();
	if (!row) return c.json({ detail: 'Recall not found' }, 404);

	return c.json(row);
});
