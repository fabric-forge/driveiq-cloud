// Theft/salvage title-brand checks — see migrations/0006_title_checks.sql.
// Populated directly (single-row-per-source data, no seed script needed at
// this scale — see driveiq-cloud/scripts for the pattern used when a
// dataset has enough rows to warrant one).

import { Hono } from 'hono';
import type { Env } from '../env.js';

export const titleChecksRoutes = new Hono<{ Bindings: Env }>();

titleChecksRoutes.get('/', async (c) => {
	const { results } = await c.env.DB.prepare('SELECT * FROM title_checks ORDER BY checked_date DESC').all();
	return c.json(results);
});

titleChecksRoutes.post('/', async (c) => {
	const body = await c.req.json<{
		vehicle_id: number;
		source: string;
		theft_status: 'clear' | 'flagged';
		salvage_status: 'clear' | 'flagged';
		checked_date?: string;
		notes?: string;
	}>();
	if (!body.vehicle_id || !body.source || !body.theft_status || !body.salvage_status) {
		return c.json({ detail: 'vehicle_id, source, theft_status, and salvage_status are required' }, 400);
	}

	const row = await c.env.DB.prepare(
		`INSERT INTO title_checks (vehicle_id, source, theft_status, salvage_status, checked_date, notes)
		 VALUES (?, ?, ?, ?, ?, ?)
		 ON CONFLICT(vehicle_id, source) DO UPDATE SET
		   theft_status = excluded.theft_status,
		   salvage_status = excluded.salvage_status,
		   checked_date = excluded.checked_date,
		   notes = excluded.notes,
		   updated_at = datetime('now')
		 RETURNING *`
	)
		.bind(body.vehicle_id, body.source, body.theft_status, body.salvage_status, body.checked_date ?? null, body.notes ?? null)
		.first();

	return c.json(row, 201);
});
