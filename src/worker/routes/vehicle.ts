// Vehicle CRUD — ports backend/app/api/vehicle.py (reference DriveIQ/FastAPI).
// Single-vehicle app: "the" vehicle is just the first row in `vehicles`.

import { Hono } from 'hono';
import type { Env } from '../env.js';

export const vehicleRoutes = new Hono<{ Bindings: Env }>();

vehicleRoutes.get('/', async (c) => {
	const vehicle = await c.env.DB.prepare('SELECT * FROM vehicles LIMIT 1').first();
	if (!vehicle) return c.json({ detail: 'Vehicle not found' }, 404);
	return c.json(vehicle);
});

vehicleRoutes.post('/', async (c) => {
	const body = await c.req.json();
	const required = ['vin', 'year', 'make', 'model'];
	for (const field of required) {
		if (body[field] === undefined) return c.json({ detail: `Missing field: ${field}` }, 400);
	}

	const result = await c.env.DB.prepare(
		`INSERT INTO vehicles (vin, year, make, model, trim, engine, transmission, drivetrain,
		  color_exterior, color_interior, purchase_date, purchase_mileage, current_mileage)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		 RETURNING *`
	)
		.bind(
			body.vin,
			body.year,
			body.make,
			body.model,
			body.trim ?? null,
			body.engine ?? null,
			body.transmission ?? null,
			body.drivetrain ?? null,
			body.color_exterior ?? null,
			body.color_interior ?? null,
			body.purchase_date ?? null,
			body.purchase_mileage ?? null,
			body.current_mileage ?? null
		)
		.first();

	return c.json(result, 201);
});

// Column allowlist for PATCH — mirrors VehicleUpdate in schemas/vehicle.py.
const UPDATABLE_FIELDS = ['current_mileage', 'color_exterior', 'color_interior'] as const;

vehicleRoutes.patch('/', async (c) => {
	const existing = await c.env.DB.prepare('SELECT * FROM vehicles LIMIT 1').first();
	if (!existing) return c.json({ detail: 'Vehicle not found' }, 404);

	const body = await c.req.json();
	const sets: string[] = [];
	const values: unknown[] = [];

	for (const field of UPDATABLE_FIELDS) {
		if (body[field] !== undefined) {
			sets.push(`${field} = ?`);
			values.push(body[field]);
		}
	}
	if (body.current_mileage !== undefined) {
		sets.push('last_mileage_update = ?');
		values.push(new Date().toISOString());
	}
	if (sets.length === 0) return c.json(existing);

	sets.push("updated_at = datetime('now')");
	values.push(existing.id);

	const updated = await c.env.DB.prepare(`UPDATE vehicles SET ${sets.join(', ')} WHERE id = ? RETURNING *`)
		.bind(...values)
		.first();
	return c.json(updated);
});

vehicleRoutes.patch('/mileage/:mileage', async (c) => {
	const mileage = Number(c.req.param('mileage'));
	if (!Number.isFinite(mileage)) return c.json({ detail: 'Invalid mileage' }, 400);

	const existing = await c.env.DB.prepare('SELECT * FROM vehicles LIMIT 1').first();
	if (!existing) return c.json({ detail: 'Vehicle not found' }, 404);

	const updated = await c.env.DB.prepare(
		`UPDATE vehicles SET current_mileage = ?, last_mileage_update = ?, updated_at = datetime('now')
		 WHERE id = ? RETURNING *`
	)
		.bind(mileage, new Date().toISOString(), existing.id)
		.first();
	return c.json(updated);
});
