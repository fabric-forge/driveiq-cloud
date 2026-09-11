// Reminder CRUD — ports the CRUD surface of backend/app/api/reminders.py
// (reference DriveIQ/FastAPI).
//
// Deliberately NOT ported here (see MIGRATION_PLAN.md phases): /smart,
// /schedule, /auto-generate, /from-schedule — these depend on
// app/data/maintenance_schedule.py + app/services/reminder_generator.py
// (Toyota service-interval data + generation logic), deferred to keep this
// scaffold reviewable. /upcoming and /:id/complete are pure DB logic and are
// ported in full.

import { Hono } from 'hono';
import type { Env } from '../env.js';
import { updateReminder, withReferenceNumber, withReferenceNumbers } from '../core/reminders.js';

export const reminderRoutes = new Hono<{ Bindings: Env }>();

reminderRoutes.get('/', async (c) => {
	const activeOnly = c.req.query('active_only') !== 'false';
	let sql = 'SELECT * FROM reminders';
	if (activeOnly) sql += ' WHERE is_active = 1 AND is_completed = 0';
	// nulls first, then ascending — matches .asc().nullsfirst() in the reference API
	sql += ' ORDER BY due_date IS NOT NULL, due_date ASC';

	const { results } = await c.env.DB.prepare(sql).all();
	return c.json(withReferenceNumbers(results as Record<string, unknown>[]));
});

// Registered before /:id — literal segment, not a record id.
reminderRoutes.get('/upcoming', async (c) => {
	const currentMileageParam = c.req.query('current_mileage');
	const currentMileage = currentMileageParam !== undefined ? Number(currentMileageParam) : undefined;

	const { results: reminders } = await c.env.DB.prepare(
		'SELECT * FROM reminders WHERE is_active = 1 AND is_completed = 0'
	).all();

	const today = new Date();
	today.setHours(0, 0, 0, 0);

	const upcoming = (reminders as any[]).filter((reminder) => {
		if (reminder.due_date) {
			const daysUntil = Math.floor((new Date(reminder.due_date).getTime() - today.getTime()) / 86_400_000);
			if (daysUntil <= reminder.notify_days_before) return true;
		}
		if (reminder.due_mileage && currentMileage !== undefined) {
			const milesUntil = reminder.due_mileage - currentMileage;
			if (milesUntil <= reminder.notify_miles_before) return true;
		}
		return false;
	});

	return c.json(withReferenceNumbers(upcoming));
});

reminderRoutes.get('/:id{[0-9]+}', async (c) => {
	const id = Number(c.req.param('id'));
	const reminder = await c.env.DB.prepare('SELECT * FROM reminders WHERE id = ?').bind(id).first();
	if (!reminder) return c.json({ detail: 'Reminder not found' }, 404);
	return c.json(withReferenceNumber(reminder as Record<string, unknown>));
});

reminderRoutes.post('/', async (c) => {
	const body = await c.req.json();
	const required = ['vehicle_id', 'title', 'reminder_type'];
	for (const field of required) {
		if (body[field] === undefined) return c.json({ detail: `Missing field: ${field}` }, 400);
	}

	const reminder = await c.env.DB.prepare(
		`INSERT INTO reminders
		  (vehicle_id, title, description, reminder_type, due_date, due_mileage, is_recurring,
		   recurrence_interval_days, recurrence_interval_miles, notify_days_before, notify_miles_before)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		 RETURNING *`
	)
		.bind(
			body.vehicle_id,
			body.title,
			body.description ?? null,
			body.reminder_type,
			body.due_date ?? null,
			body.due_mileage ?? null,
			body.is_recurring ? 1 : 0,
			body.recurrence_interval_days ?? null,
			body.recurrence_interval_miles ?? null,
			body.notify_days_before ?? 7,
			body.notify_miles_before ?? 500
		)
		.first();

	return c.json(withReferenceNumber(reminder as Record<string, unknown>), 201);
});

reminderRoutes.patch('/:id{[0-9]+}', async (c) => {
	const id = Number(c.req.param('id'));
	const existing = await c.env.DB.prepare('SELECT * FROM reminders WHERE id = ?').bind(id).first();
	if (!existing) return c.json({ detail: 'Reminder not found' }, 404);

	const body = await c.req.json();
	const updated = await updateReminder(c.env, id, body);
	return c.json(withReferenceNumber(updated as Record<string, unknown>));
});

reminderRoutes.post('/:id{[0-9]+}/complete', async (c) => {
	const id = Number(c.req.param('id'));
	const reminder = await c.env.DB.prepare('SELECT * FROM reminders WHERE id = ?').bind(id).first();
	if (!reminder) return c.json({ detail: 'Reminder not found' }, 404);

	const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);
	let mileage = body.mileage as number | undefined;
	if (mileage === undefined) {
		const vehicle = await c.env.DB.prepare('SELECT * FROM vehicles WHERE id = ?').bind(reminder.vehicle_id).first();
		mileage = (vehicle?.current_mileage as number | undefined) ?? (reminder.due_mileage as number | undefined) ?? 0;
	}

	const today = new Date().toISOString().slice(0, 10);
	await c.env.DB.prepare(
		`INSERT INTO maintenance_records
		  (vehicle_id, maintenance_type, description, date_performed, mileage, cost, service_provider, notes)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
	)
		.bind(
			reminder.vehicle_id,
			reminder.title,
			reminder.description ?? `Completed from reminder: ${reminder.title}`,
			today,
			mileage,
			(body.cost as number | undefined) ?? null,
			(body.service_provider as string | undefined) ?? null,
			(body.notes as string | undefined) ?? 'Created automatically from completed reminder'
		)
		.run();

	const nowIso = new Date().toISOString();
	const updated = await c.env.DB.prepare(
		"UPDATE reminders SET is_completed = 1, completed_at = ?, updated_at = datetime('now') WHERE id = ? RETURNING *"
	)
		.bind(nowIso, id)
		.first();

	if (reminder.is_recurring) {
		let nextDueDate: string | null = reminder.due_date as string | null;
		if (reminder.recurrence_interval_days && reminder.due_date) {
			const d = new Date(reminder.due_date as string);
			d.setDate(d.getDate() + (reminder.recurrence_interval_days as number));
			nextDueDate = d.toISOString().slice(0, 10);
		}
		const nextDueMileage = reminder.recurrence_interval_miles
			? mileage + (reminder.recurrence_interval_miles as number)
			: null;

		await c.env.DB.prepare(
			`INSERT INTO reminders
			  (vehicle_id, title, description, reminder_type, due_date, due_mileage, is_recurring,
			   recurrence_interval_days, recurrence_interval_miles, notify_days_before, notify_miles_before)
			 VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`
		)
			.bind(
				reminder.vehicle_id,
				reminder.title,
				reminder.description,
				reminder.reminder_type,
				nextDueDate,
				nextDueMileage,
				reminder.recurrence_interval_days,
				reminder.recurrence_interval_miles,
				reminder.notify_days_before,
				reminder.notify_miles_before
			)
			.run();
	}

	return c.json(withReferenceNumber(updated as Record<string, unknown>));
});

reminderRoutes.delete('/:id{[0-9]+}', async (c) => {
	const id = Number(c.req.param('id'));
	const existing = await c.env.DB.prepare('SELECT id FROM reminders WHERE id = ?').bind(id).first();
	if (!existing) return c.json({ detail: 'Reminder not found' }, 404);

	await c.env.DB.prepare('DELETE FROM reminders WHERE id = ?').bind(id).run();
	return c.json({ message: 'Reminder deleted' });
});
