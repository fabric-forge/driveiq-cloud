// Toyota 4Runner (2018) manufacturer-recommended maintenance intervals.
// Mirrors driveiq-ui's src/lib/maintenanceSchedule.ts — kept in sync by hand
// since the frontend and worker are separate repos/packages. Used to give
// Aiana (search.ts /ask) deterministic "when is my next X due" answers
// instead of asking the LLM to do interval arithmetic itself.

export interface ScheduleItem {
	type: string;
	name: string;
	intervalMiles: number;
	intervalMonths: number;
}

export const MAINTENANCE_SCHEDULE: ScheduleItem[] = [
	{ type: 'oil_change', name: 'Oil & Filter Change', intervalMiles: 5000, intervalMonths: 6 },
	{ type: 'tire_rotation', name: 'Tire Rotation', intervalMiles: 5000, intervalMonths: 6 },
	{ type: 'air_filter', name: 'Engine Air Filter', intervalMiles: 30000, intervalMonths: 36 },
	{ type: 'cabin_filter', name: 'Cabin Air Filter', intervalMiles: 15000, intervalMonths: 12 },
	{ type: 'brake_fluid', name: 'Brake Fluid', intervalMiles: 30000, intervalMonths: 36 },
	{ type: 'transmission_fluid', name: 'Transmission Fluid', intervalMiles: 60000, intervalMonths: 72 },
	{ type: 'coolant', name: 'Engine Coolant', intervalMiles: 100000, intervalMonths: 120 },
	{ type: 'spark_plugs', name: 'Spark Plugs', intervalMiles: 120000, intervalMonths: 120 },
	{ type: 'drive_belt', name: 'Drive Belt', intervalMiles: 100000, intervalMonths: 120 },
	{ type: 'brake_pads_front', name: 'Front Brake Pads', intervalMiles: 40000, intervalMonths: 48 },
	{ type: 'brake_pads_rear', name: 'Rear Brake Pads', intervalMiles: 50000, intervalMonths: 60 },
	{ type: 'battery', name: 'Battery', intervalMiles: 50000, intervalMonths: 48 },
	{ type: 'wiper_blades', name: 'Wiper Blades', intervalMiles: 15000, intervalMonths: 12 },
];

export interface MaintenanceRecordRow {
	maintenance_type: string;
	date_performed: string;
	mileage: number;
}

export interface ServiceStatus {
	type: string;
	name: string;
	lastPerformedDate: string | null;
	lastPerformedMileage: number | null;
	dueMileage: number;
	milesRemaining: number | null;
	estimatedDueDate: string | null;
	status: 'overdue' | 'due_soon' | 'ok' | 'no_record';
}

function estimateDueDate(lastPerformedDate: string | null, intervalMonths: number): string | null {
	if (!lastPerformedDate) return null;
	const [y, m, d] = lastPerformedDate.split('-').map(Number);
	const due = new Date(Date.UTC(y, m - 1 + intervalMonths, d));
	return `${due.getUTCFullYear()}-${String(due.getUTCMonth() + 1).padStart(2, '0')}-${String(due.getUTCDate()).padStart(2, '0')}`;
}

/** Builds per-type service status (last performed + next due, mileage and
 * estimated date) for every schedule item, using the most recent record of
 * each maintenance_type. Also includes any maintenance_type present in the
 * records that isn't in MAINTENANCE_SCHEDULE (e.g. one-off "service" /
 * "rustproofing" entries), so Aiana can still answer "when was my last X"
 * for those even though there's no interval to project forward. */
export function buildServiceStatus(
	records: MaintenanceRecordRow[],
	currentMileage: number | null,
	dueSoonWindowMiles = 1000
): ServiceStatus[] {
	const latestByType = new Map<string, MaintenanceRecordRow>();
	for (const r of records) {
		const existing = latestByType.get(r.maintenance_type);
		if (!existing || r.date_performed > existing.date_performed) latestByType.set(r.maintenance_type, r);
	}

	const scheduled: ServiceStatus[] = MAINTENANCE_SCHEDULE.map((item) => {
		const last = latestByType.get(item.type);
		latestByType.delete(item.type);
		const dueMileage = last ? last.mileage + item.intervalMiles : item.intervalMiles;
		const milesRemaining = currentMileage != null ? dueMileage - currentMileage : null;

		let status: ServiceStatus['status'] = 'no_record';
		if (last) {
			status = 'ok';
			if (milesRemaining != null) {
				if (milesRemaining <= 0) status = 'overdue';
				else if (milesRemaining <= dueSoonWindowMiles) status = 'due_soon';
			}
		}

		return {
			type: item.type,
			name: item.name,
			lastPerformedDate: last?.date_performed ?? null,
			lastPerformedMileage: last?.mileage ?? null,
			dueMileage,
			milesRemaining,
			estimatedDueDate: estimateDueDate(last?.date_performed ?? null, item.intervalMonths),
			status,
		};
	});

	// Any leftover types (not in the standard schedule) — no projection, just history.
	const unscheduled: ServiceStatus[] = [...latestByType.entries()].map(([type, last]) => ({
		type,
		name: type.replace(/_/g, ' '),
		lastPerformedDate: last.date_performed,
		lastPerformedMileage: last.mileage,
		dueMileage: last.mileage,
		milesRemaining: null,
		estimatedDueDate: null,
		status: 'ok',
	}));

	return [...scheduled, ...unscheduled];
}

/** Renders the service status list as a compact markdown table for the
 * system prompt. Includes the raw `type` slug (e.g. "coolant") alongside the
 * display name — Aiana needs the exact slug, not the name, when tagging a
 * reminder's maintenance_type to link it to one of these forecast rows. */
export function formatServiceStatusTable(statuses: ServiceStatus[]): string {
	const header = '| Service | Type | Last Performed | Next Due (mileage) | Next Due (est. date) | Status |\n|---|---|---|---|---|---|';
	const rows = statuses.map((s) => {
		const last = s.lastPerformedDate ? `${s.lastPerformedDate} @ ${s.lastPerformedMileage?.toLocaleString()} mi` : 'No record on file';
		const dueMi = s.status === 'no_record' || s.milesRemaining === null ? '—' : `${s.dueMileage.toLocaleString()} mi`;
		const dueDate = s.estimatedDueDate ?? '—';
		const statusLabel = { overdue: 'OVERDUE', due_soon: 'Due soon', ok: 'OK', no_record: 'Never logged' }[s.status];
		return `| ${s.name} | ${s.type} | ${last} | ${dueMi} | ${dueDate} | ${statusLabel} |`;
	});
	return [header, ...rows].join('\n');
}
