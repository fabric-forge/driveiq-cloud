// DriveIQ Cloud — NHTSA recalls seed (one-time compile, run locally)
//
// Populates the recalls table from a Public Data Records VIN report
// (uploaded to Aiana separately as the source document) — the Dashboard's
// Recalls card was previously a hardcoded "Clear" stub with no real data.
//
// Status defaults to 'open' for all five (see migrations/0005_recalls.sql —
// the source report only confirms a campaign exists and when its remedy
// became available, not whether this specific vehicle's remedy was ever
// completed). Update via PATCH /api/recalls/:id once the owner confirms
// which of these were actually addressed at a Toyota dealer visit.
//
// Re-run any time a value needs correcting — it's an upsert keyed on
// nhtsa_campaign, not append-only.
//
// Run:
//   1. In one terminal: npx wrangler dev
//   2. In another:      node scripts/seed-recalls.mjs

const WORKER_URL = process.env.WORKER_URL ?? 'http://localhost:8787';
const VEHICLE_ID = 1;

const RECALLS = [
	{
		nhtsa_campaign: '17V763000',
		component: 'STRUCTURE:BODY:HOOD',
		report_receipt_date: '2017-11-29',
		summary:
			'Southeast Toyota Distributors, LLC (SET) is recalling certain 2015-2018 Toyota 4Runner vehicles equipped with an accessory billet grille overlay installed by SET or provided by SET and installed by SET dealers. The U-nut that secures the overlay grille may fracture, allowing the billet grille overlay to detach from the vehicle.',
		consequence:
			'If the billet grille overlay detaches while driving, it can become a road hazard, increasing the risk of a crash.',
		remedy:
			'SET will notify owners, and dealers will replace the securing U-nuts with upgraded hardware, free of charge. The recall was expected to begin January 26, 2018. Owners may contact SET customer service at 1-866-405-4226. SET\'s number for this recall is SET17C.',
	},
	{
		nhtsa_campaign: '17V831000',
		component: 'EQUIPMENT:OTHER:LABELS',
		report_receipt_date: '2017-12-20',
		summary:
			'Toyota Motor Engineering & Manufacturing (Toyota) is recalling certain 2017-2018 Toyota 4Runner and Tundra, 2018 Toyota Highlander, RAV4 and Lexus GX460, and 2017 Toyota Sienna and Tacoma vehicles. These vehicles may have incorrect load carrying capacity modification labels. As such, these vehicles fail to comply with the requirements of Federal Motor Vehicle Safety Standard (FMVSS) number 110, "Tire Selection and Rims."',
		consequence:
			'An incorrect load information label can result in the operator overloading the vehicle and increasing the risk of a crash.',
		remedy:
			"Toyota will notify owners and provide them with corrected labels, free of charge. The recall began on January 23, 2018. Owners may contact Toyota customer service at 1-800-331-4331. Toyota's numbers for this recall are H0Z for Toyota vehicles, and HLF for Lexus vehicles.",
	},
	{
		nhtsa_campaign: '18V753000',
		component: 'EQUIPMENT:OTHER:LABELS',
		report_receipt_date: '2018-10-25',
		summary:
			'Southeast Toyota Distributors, LLC (SET) is recalling certain 2017-2019 Toyota 4Runner vehicles that SET modified to be equipped with a TRD wheel package. The Gross Vehicle Weight Rating (GVWR) on the certification label may be incorrect, possibly resulting in the vehicle being overloaded. As such, these vehicles fail to comply with the requirements of Federal Motor Vehicle Safety Standard (FMVSS) number 110, "Tire Selection and Rims."',
		consequence: 'An overloaded vehicle can increase the risk of a crash.',
		remedy:
			"SET will notify owners and mail them corrected certification labels, free of charge. The recall began November 28, 2018. Owners may contact SET customer service at 1-866-405-4226. SET's number for this recall is SET18A.",
	},
	{
		nhtsa_campaign: '19V670000',
		component: 'STEERING',
		report_receipt_date: '2019-09-20',
		summary:
			'Southeast Toyota Distributors, LLC (SET) is recalling certain 2018-2019 Toyota 4Runner vehicles. During installation, certain steering and suspension components may not have been properly tightened.',
		consequence:
			'Loose fasteners may cause a loss of vehicle control, or cause an accessory to detach from the vehicle and become a road hazard. Either of these scenarios can increase the risk of a crash or injury.',
		remedy:
			"SET will notify owners, and dealers will inspect and re-tighten the steering and suspension fasteners as necessary, free of charge. The recall was expected to begin November 19, 2019. Owners may contact SET customer service at 1-866-405-4226. SET's number for this recall is SET19B.",
	},
	{
		nhtsa_campaign: '20V682000',
		component: 'FUEL SYSTEM, GASOLINE:DELIVERY:FUEL PUMP',
		report_receipt_date: '2020-11-04',
		summary:
			'Toyota Motor Engineering & Manufacturing (Toyota) is recalling certain 2018-2019 4Runner and a broad range of other Toyota/Lexus models. The low-pressure fuel pump inside the fuel tank may fail.',
		consequence: 'If the fuel pump fails, the engine can stall while driving, increasing the risk of a crash.',
		remedy:
			"Toyota will notify owners, and dealers will replace the fuel pump assembly with an improved one, free of charge. Remedy parts were expected to be available for all affected vehicles by late March 2021. Owners may contact Toyota customer service at 1-888-270-9371 or Lexus customer service at 1-800-255-3987. This recall is an expansion of recall 20V-012. Toyota's number for this recall is 20TA02.",
	},
];

async function main() {
	for (const recall of RECALLS) {
		const res = await fetch(`${WORKER_URL}/api/recalls`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ vehicle_id: VEHICLE_ID, ...recall }),
		});
		if (!res.ok) throw new Error(`Failed to seed ${recall.nhtsa_campaign}: ${res.status} ${await res.text()}`);
		console.log(`Seeded ${recall.nhtsa_campaign} (${recall.component})`);
	}
	console.log('Done.');
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
