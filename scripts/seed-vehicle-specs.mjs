// DriveIQ Cloud — vehicle specs seed (one-time compile, run locally)
//
// Populates the vehicle_specs table with OEM specs the owner's manual
// doesn't have exact numbers for (tire size, oil capacity, spark plugs,
// cabin filter, drive belt) — that's factory-service-manual / dealer-
// parts-catalog territory. Researched via web search, reviewed by the
// vehicle owner before being seeded here (see the driveiq-ui#19 PR
// discussion — the owner corrected the drive belt part number after the
// first research pass, which is exactly why this is a reviewed one-time
// compile and not an auto-generated live lookup).
//
// Not exhaustive — only the maintenance types listed below have a curated
// row. ForecastCard falls back to the live Aiana lookup for anything not
// covered here (brake fluid, transmission fluid, etc.).
//
// Re-run any time a value needs correcting (e.g. after a tire size change)
// — it's an upsert keyed on (vehicle_id, maintenance_type), not append-only.
//
// Run:
//   1. In one terminal: npx wrangler dev
//   2. In another:      node scripts/seed-vehicle-specs.mjs

const WORKER_URL = process.env.WORKER_URL ?? 'http://localhost:8787';
const VEHICLE_ID = 1;

const SPECS = [
	{
		maintenance_type: 'tire_rotation',
		spec_text: 'P265/70R17 (113S) on 17x7 wheels. Rotate front-to-back (straight swap, not X-pattern).',
		part_number: null,
		source_note:
			'Tire size confirmed across multiple sources for the 2018 4Runner SR5 Premium. Rotation pattern is NOT independently verified against the owner\'s manual — worth a spot check against the actual printed pattern before fully trusting it.',
	},
	{
		maintenance_type: 'oil_change',
		spec_text: '0W-20 full synthetic (Toyota TGMO or equivalent), 6.6 qt with filter (1GR-FE 4.0L V6).',
		part_number: null,
		source_note: 'Consistent across independent sources.',
	},
	{
		maintenance_type: 'spark_plugs',
		spec_text: '6 plugs (V6). Gap ~0.043-0.044in — OEM iridium plugs typically come pre-gapped from the factory.',
		part_number: '90919-01233',
		source_note:
			'Toyota OEM part number (Denso SK16HR11 is the same physical part under Denso\'s own numbering). Gap figure sourced from an aftermarket cross-reference, not confirmed directly against Toyota factory spec.',
	},
	{
		maintenance_type: 'cabin_filter',
		spec_text: 'Toyota OEM cabin air filter.',
		part_number: '87139-0E040',
		source_note: 'Well corroborated across Toyota dealer parts listings for 2018-2026 fitment.',
	},
	{
		maintenance_type: 'drive_belt',
		spec_text: 'Serpentine (accessory drive) belt, 84.66in.',
		part_number: '90916-A2015',
		source_note:
			'Confirmed by the vehicle owner directly; corroborated across multiple Toyota dealer parts sites for 2010-2019 4Runner 4.0L V6.',
	},
];

async function main() {
	for (const spec of SPECS) {
		const res = await fetch(`${WORKER_URL}/api/vehicle-specs`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ vehicle_id: VEHICLE_ID, ...spec }),
		});
		if (!res.ok) throw new Error(`Failed to seed ${spec.maintenance_type}: ${res.status} ${await res.text()}`);
		console.log(`Seeded ${spec.maintenance_type}`);
	}
	console.log('Done.');
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
