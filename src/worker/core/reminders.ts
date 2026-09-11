// Shared reminder-update logic — used by the reminders CRUD route
// (routes/reminders.ts, PATCH /api/reminders/:id) and by Aiana's
// update_reminder tool (routes/search.ts) so both editing paths stay in
// sync on which fields are editable and how they're written.

import type { Env } from '../env.js';

export const REMINDER_UPDATABLE_FIELDS = [
	'title',
	'description',
	'reminder_type',
	'due_date',
	'due_mileage',
	'category',
	'is_recurring',
	'recurrence_interval_days',
	'recurrence_interval_miles',
	'notify_days_before',
	'notify_miles_before',
] as const;

const BOOLEAN_FIELDS = new Set<string>(['is_recurring']);

// Applies whichever of REMINDER_UPDATABLE_FIELDS/is_active/is_completed are
// present (not undefined) in `body` to the reminder, and returns the updated
// row. Caller is responsible for confirming the reminder exists first.
export async function updateReminder(env: Env, id: number, body: Record<string, unknown>): Promise<Record<string, unknown> | null> {
	const sets: string[] = [];
	const values: unknown[] = [];

	for (const field of REMINDER_UPDATABLE_FIELDS) {
		if (body[field] === undefined) continue;
		sets.push(`${field} = ?`);
		values.push(BOOLEAN_FIELDS.has(field) ? (body[field] ? 1 : 0) : body[field]);
	}
	if (body.is_active !== undefined) {
		sets.push('is_active = ?');
		values.push(body.is_active ? 1 : 0);
	}
	if (body.is_completed !== undefined) {
		sets.push('is_completed = ?');
		values.push(body.is_completed ? 1 : 0);
		if (body.is_completed) {
			sets.push('completed_at = ?');
			values.push(new Date().toISOString());
		}
	}

	if (sets.length === 0) {
		return env.DB.prepare('SELECT * FROM reminders WHERE id = ?').bind(id).first();
	}

	sets.push("updated_at = datetime('now')");
	values.push(id);

	return env.DB.prepare(`UPDATE reminders SET ${sets.join(', ')} WHERE id = ? RETURNING *`)
		.bind(...values)
		.first();
}
