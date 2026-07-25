-- Mirrors backend/app/models/{vehicle,maintenance,reminder}.py from the
-- reference ry-ops/DriveIQ (FastAPI/Postgres) checkout. All columns there are
-- plain scalars — no Postgres-specific types — so the port to D1/SQLite is
-- 1:1. Booleans are stored as INTEGER 0/1 (SQLite has no native boolean).
-- Timestamps are ISO 8601 TEXT.

CREATE TABLE vehicles (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	vin TEXT NOT NULL UNIQUE,
	year INTEGER NOT NULL,
	make TEXT NOT NULL,
	model TEXT NOT NULL,
	trim TEXT,
	engine TEXT,
	transmission TEXT,
	drivetrain TEXT,
	color_exterior TEXT,
	color_interior TEXT,
	purchase_date TEXT,
	purchase_mileage INTEGER,
	current_mileage INTEGER,
	last_mileage_update TEXT,
	created_at TEXT NOT NULL DEFAULT (datetime('now')),
	updated_at TEXT
);

CREATE TABLE maintenance_records (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	vehicle_id INTEGER NOT NULL REFERENCES vehicles(id),
	maintenance_type TEXT NOT NULL,
	description TEXT,
	date_performed TEXT NOT NULL,
	mileage INTEGER NOT NULL,
	cost REAL,
	parts_cost REAL,
	labor_cost REAL,
	service_provider TEXT,
	location TEXT,
	parts_used TEXT,   -- JSON-encoded string, same as the Postgres original
	notes TEXT,
	documents TEXT,    -- JSON-encoded array of filenames (Phase 3: R2 keys)
	photos TEXT,       -- JSON-encoded array of photo objects (Phase 3: R2 keys)
	created_at TEXT NOT NULL DEFAULT (datetime('now')),
	updated_at TEXT
);

CREATE INDEX idx_maintenance_vehicle_id ON maintenance_records(vehicle_id);
CREATE INDEX idx_maintenance_date_performed ON maintenance_records(date_performed);
CREATE INDEX idx_maintenance_type ON maintenance_records(maintenance_type);

CREATE TABLE reminders (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	vehicle_id INTEGER NOT NULL REFERENCES vehicles(id),
	title TEXT NOT NULL,
	description TEXT,
	reminder_type TEXT NOT NULL, -- mileage | date | both
	due_date TEXT,
	due_mileage INTEGER,
	is_recurring INTEGER NOT NULL DEFAULT 0,
	recurrence_interval_days INTEGER,
	recurrence_interval_miles INTEGER,
	is_active INTEGER NOT NULL DEFAULT 1,
	is_completed INTEGER NOT NULL DEFAULT 0,
	completed_at TEXT,
	notify_days_before INTEGER NOT NULL DEFAULT 7,
	notify_miles_before INTEGER NOT NULL DEFAULT 500,
	last_notified TEXT,
	created_at TEXT NOT NULL DEFAULT (datetime('now')),
	updated_at TEXT
);

CREATE INDEX idx_reminders_vehicle_id ON reminders(vehicle_id);
CREATE INDEX idx_reminders_active ON reminders(is_active, is_completed);
