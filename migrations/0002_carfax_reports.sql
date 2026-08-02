-- Phase 3 slice: CARFAX report storage (see MIGRATION_PLAN.md). Trimmed from
-- the reference's carfax_reports table (backend/app/api/import_data.py) to
-- the fields driveiq-ui actually shows (Dashboard's Est. Value stat + the
-- owner-count badge) — not the full body_style/fuel_type/CPO/ownership-length
-- columns that fed UI this rebuild doesn't have yet. Add columns here if
-- that UI gets built.

CREATE TABLE carfax_reports (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	vin TEXT NOT NULL UNIQUE,
	vehicle TEXT,
	year INTEGER,
	make TEXT,
	model TEXT,
	trim TEXT,
	engine TEXT,
	drivetrain TEXT,
	retail_value INTEGER,
	report_date TEXT,
	owner_count INTEGER,
	accidents INTEGER NOT NULL DEFAULT 0,
	no_accidents INTEGER NOT NULL DEFAULT 1,
	single_owner INTEGER NOT NULL DEFAULT 0,
	last_odometer INTEGER,
	imported_at TEXT NOT NULL DEFAULT (datetime('now')),
	updated_at TEXT
);
