// CARFAX report import — the structured-field slice of Phase 3's "CARFAX
// import flow" (see MIGRATION_PLAN.md). Field extraction happens locally in
// scripts/import-carfax.mjs (pdf-parse, same pattern as ingest.mjs) — this
// route only stores/serves the already-parsed JSON. The Worker never does
// PDF text extraction itself, matching how RAG document ingestion works.
//
// Not ported: the reference's per-line-item service-record extraction,
// dealer name/rating/phone parsing, and warranty-coverage detection
// (backend/app/services/carfax_parser.py). Those fed a CARFAX-sourced
// service history the current UI doesn't surface — only retail_value and
// owner_count are shown (Dashboard's Est. Value stat + owner-count badge).

import { Hono } from 'hono';
import type { Env } from '../env.js';

export const importRoutes = new Hono<{ Bindings: Env }>();

interface CarfaxReportInput {
	vin: string;
	vehicle?: string | null;
	year?: number | null;
	make?: string | null;
	model?: string | null;
	trim?: string | null;
	engine?: string | null;
	drivetrain?: string | null;
	retail_value?: number | null;
	report_date?: string | null;
	owner_count?: number | null;
	accidents?: number | null;
	no_accidents?: boolean | null;
	single_owner?: boolean | null;
	last_odometer?: number | null;
}

importRoutes.get('/carfax-report', async (c) => {
	const report = await c.env.DB.prepare(
		'SELECT * FROM carfax_reports ORDER BY updated_at DESC, imported_at DESC LIMIT 1'
	).first();
	if (!report) return c.json({ detail: 'No CARFAX report found' }, 404);
	return c.json(report);
});

importRoutes.post('/carfax-report', async (c) => {
	const body = await c.req.json<CarfaxReportInput>();
	if (!body.vin) return c.json({ detail: 'Missing field: vin' }, 400);

	const report = await c.env.DB.prepare(
		`INSERT INTO carfax_reports
		  (vin, vehicle, year, make, model, trim, engine, drivetrain, retail_value,
		   report_date, owner_count, accidents, no_accidents, single_owner, last_odometer)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		 ON CONFLICT(vin) DO UPDATE SET
		   vehicle = excluded.vehicle,
		   year = excluded.year,
		   make = excluded.make,
		   model = excluded.model,
		   trim = excluded.trim,
		   engine = excluded.engine,
		   drivetrain = excluded.drivetrain,
		   retail_value = excluded.retail_value,
		   report_date = excluded.report_date,
		   owner_count = excluded.owner_count,
		   accidents = excluded.accidents,
		   no_accidents = excluded.no_accidents,
		   single_owner = excluded.single_owner,
		   last_odometer = excluded.last_odometer,
		   updated_at = datetime('now')
		 RETURNING *`
	)
		.bind(
			body.vin,
			body.vehicle ?? null,
			body.year ?? null,
			body.make ?? null,
			body.model ?? null,
			body.trim ?? null,
			body.engine ?? null,
			body.drivetrain ?? null,
			body.retail_value ?? null,
			body.report_date ?? null,
			body.owner_count ?? null,
			body.accidents ?? 0,
			body.no_accidents === false ? 0 : 1,
			body.single_owner ? 1 : 0,
			body.last_odometer ?? null
		)
		.first();

	return c.json(report, 201);
});
