-- Curated OEM specs (tire size, oil capacity, spark plugs, cabin filter,
-- drive belt, etc.) that the owner's manual usually doesn't have exact
-- numbers for — that's factory-service-manual / dealer-parts-catalog
-- territory. Populated by a one-time research pass (scripts/seed-vehicle-
-- specs.mjs), reviewed by the vehicle owner, not auto-generated per request.
--
-- Deliberately a plain structured table, not another Qdrant document: these
-- are precise facts (a part number, a torque spec), not prose to semantically
-- search — a direct read is instant and exact, where RAG would add latency,
-- LLM cost, and re-phrasing variance for an answer that should never change.
-- driveiq-ui's ForecastCard reads this directly for known maintenance_types
-- and only falls back to the live Aiana lookup for types not yet researched.

CREATE TABLE vehicle_specs (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	vehicle_id INTEGER NOT NULL REFERENCES vehicles(id),
	maintenance_type TEXT NOT NULL,
	spec_text TEXT NOT NULL,
	part_number TEXT,
	source_note TEXT,
	created_at TEXT NOT NULL DEFAULT (datetime('now')),
	updated_at TEXT,
	UNIQUE(vehicle_id, maintenance_type)
);
