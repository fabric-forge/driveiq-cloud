-- Theft/salvage title-brand checks, sourced from a public VIN-check service
-- (NICB VINCheck, nicb.org — free public theft/total-loss lookup, separate
-- from CARFAX's own title-brand data). One row per source per vehicle —
-- UNIQUE(vehicle_id, source) so re-checking the same source later updates
-- in place rather than accumulating duplicate rows, matching vehicle_specs'
-- upsert pattern. Deliberately a plain table, not another Qdrant document:
-- theft/salvage status is an exact per-source fact the Dashboard needs on
-- every load, same reasoning as recalls (migrations/0005_recalls.sql).

CREATE TABLE title_checks (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	vehicle_id INTEGER NOT NULL REFERENCES vehicles(id),
	source TEXT NOT NULL,
	theft_status TEXT NOT NULL CHECK (theft_status IN ('clear', 'flagged')),
	salvage_status TEXT NOT NULL CHECK (salvage_status IN ('clear', 'flagged')),
	checked_date TEXT,
	notes TEXT,
	created_at TEXT NOT NULL DEFAULT (datetime('now')),
	updated_at TEXT,
	UNIQUE(vehicle_id, source)
);
