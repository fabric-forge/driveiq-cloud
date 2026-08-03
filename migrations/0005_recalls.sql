-- NHTSA recall records for this VIN, sourced from a Public Data Records VIN
-- report (see scripts/seed-recalls.mjs) — the Dashboard's Recalls card was
-- previously a hardcoded "Clear" stub with no data behind it at all.
-- Deliberately a plain table, not a Qdrant document: recall status is a
-- precise fact per campaign, not prose to semantically search, and the
-- Dashboard needs an exact count/list on every load, not an LLM round trip.

CREATE TABLE recalls (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	vehicle_id INTEGER NOT NULL REFERENCES vehicles(id),
	nhtsa_campaign TEXT NOT NULL UNIQUE,
	component TEXT NOT NULL,
	summary TEXT NOT NULL,
	consequence TEXT,
	remedy TEXT,
	report_receipt_date TEXT,
	-- Whether this vehicle's own remedy has been completed. Not reported by
	-- the source VIN report (which only lists that a campaign exists and
	-- when the remedy became available) — defaults to unresolved until the
	-- owner confirms tender/completion, matching how a real recall stays
	-- "open" until service is actually performed, not just offered.
	status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'remedied')),
	created_at TEXT NOT NULL DEFAULT (datetime('now')),
	updated_at TEXT
);
