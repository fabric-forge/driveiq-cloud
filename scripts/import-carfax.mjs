// DriveIQ Cloud — CARFAX report import (one-off, run locally)
//
// Extracts vehicle-value/history fields from a CARFAX PDF (VIN, retail
// value, owner count, accident history) and POSTs them to a locally-running
// `wrangler dev` instance, which upserts into the carfax_reports D1 table.
// Same file already used for RAG ingestion in ingest.mjs's DOCUMENTS list —
// this script reads it a second time for structured fields instead of text
// chunks.
//
// Ported from the reference ry-ops/DriveIQ
// backend/app/services/carfax_parser.py, trimmed to the fields the UI
// actually shows (Dashboard's Est. Value card + owner-count badge) — not
// the full per-line-item service-record/dealer/warranty extraction that
// file also does (see src/worker/routes/import.ts for why that's unused
// here).
//
// Run:
//   1. In one terminal: npx wrangler dev
//   2. In another:      node scripts/import-carfax.mjs

import { readFile } from 'node:fs/promises';
import { PDFParse } from 'pdf-parse';

const DOCS_DIR = `${process.env.HOME}/Desktop/4runner`;
const CARFAX_FILE = 'CARFAX Vehicle History Report for this 2018 TOYOTA 4RUNNER SR5 PREMIUM_ JTEBU5JR2J5517128.pdf';
const WORKER_URL = process.env.WORKER_URL ?? 'http://localhost:8787';

function extractVin(text) {
	const m = /VIN[:\s]*([A-HJ-NPR-Z0-9]{17})/i.exec(text);
	return m ? m[1] : null;
}

function extractVehicleSpecs(text) {
	const specs = { year: null, make: null, model: null, trim: null, engine: null, drivetrain: null };

	const vehicleMatch = /(\d{4})\s+(TOYOTA|Honda|Ford|Chevrolet|Nissan|BMW|Mercedes|Lexus|Acura)\s*\n?\s*([A-Z0-9]+(?:\s+(?!VIN\b)[A-Z0-9]+)*)/i.exec(
		text
	);
	if (vehicleMatch) {
		specs.year = Number(vehicleMatch[1]);
		specs.make = vehicleMatch[2][0].toUpperCase() + vehicleMatch[2].slice(1).toLowerCase();
		const parts = vehicleMatch[3].trim().split(/\s+/);
		specs.model = parts[0] ?? null;
		if (parts.length > 1) specs.trim = parts.slice(1).join(' ');
	}

	const engineMatch = /(\d\.\d)L\s*(V\d+|I\d+|INLINE)?\s*[A-Z]*\s*(?:DOHC|SOHC)?\s*\d*V?/i.exec(text);
	if (engineMatch) specs.engine = engineMatch[0].trim();

	if (/REAR\s+WHEEL\s+DRIVE\s+W\/\s*4X4/i.test(text)) specs.drivetrain = '4WD';
	else if (/ALL\s+WHEEL\s+DRIVE|AWD/i.test(text)) specs.drivetrain = 'AWD';
	else if (/FRONT\s+WHEEL\s+DRIVE|FWD/i.test(text)) specs.drivetrain = 'FWD';
	else if (/REAR\s+WHEEL\s+DRIVE|RWD/i.test(text)) specs.drivetrain = 'RWD';
	else if (/4X4|4WD/i.test(text)) specs.drivetrain = '4WD';

	return specs;
}

function extractRetailValue(text) {
	const patterns = [
		/\$(\d{1,3},?\d{3})\s*(?:CARFAX\s+)?Retail\s+Value/i,
		/CARFAX\s+Retail\s+Value[:\s]*\$(\d{1,3},?\d{3})/i,
		/\$(\d{1,3},?\d{3})\s*\n\s*CARFAX\s+Retail/i,
	];
	for (const pattern of patterns) {
		const m = pattern.exec(text);
		if (m) return Number(m[1].replace(/,/g, ''));
	}
	return null;
}

function extractReportDate(text) {
	const m = /(\d{1,2}\/\d{1,2}\/\d{2,4})\s+\d{1,2}:\d{2}:\d{2}\s*(?:AM|PM)/.exec(text);
	return m ? m[1] : null;
}

function extractOwnerCount(text) {
	const m = /(\d+)\s*-?\s*(?:owner|Owner)/.exec(text);
	if (m) return Number(m[1]);
	if (/CARFAX\s+1-Owner/.test(text)) return 1;
	return null;
}

function extractLastOdometer(text) {
	// Comma is mandatory: without it, a loose \d{0,3} tail matches any nearby
	// 1-4 digit number (e.g. a model year on the following line) as a false
	// positive odometer reading.
	let m = /Last\s+reported\s+odometer\s+reading\s*(\d{1,3},\d{3})/.exec(text);
	if (!m) m = /(\d{1,3},\d{3})\s*Last\s+reported\s+odometer/.exec(text);
	return m ? Number(m[1].replace(/,/g, '')) : null;
}

function extractAccidents(text) {
	if (/No\s+accidents?\s+(?:or\s+damage\s+)?reported/i.test(text)) return 0;
	const m = /(\d+)\s+accidents?\s+reported/i.exec(text);
	return m ? Number(m[1]) : 0;
}

async function main() {
	const path = `${DOCS_DIR}/${CARFAX_FILE}`;
	console.log(`Parsing CARFAX report (${path})...`);
	const buffer = await readFile(path);
	const parser = new PDFParse({ data: buffer });
	const result = await parser.getText();
	await parser.destroy();
	const text = result.text ?? '';

	const vin = extractVin(text);
	if (!vin) throw new Error('Could not find a VIN in the CARFAX PDF text — is this the right document?');

	const specs = extractVehicleSpecs(text);
	const ownerCount = extractOwnerCount(text);

	const report = {
		vin,
		vehicle:
			specs.year && specs.make && specs.model
				? `${specs.year} ${specs.make} ${specs.model}${specs.trim ? ' ' + specs.trim : ''}`
				: null,
		year: specs.year,
		make: specs.make,
		model: specs.model,
		trim: specs.trim,
		engine: specs.engine,
		drivetrain: specs.drivetrain,
		retail_value: extractRetailValue(text),
		report_date: extractReportDate(text),
		owner_count: ownerCount,
		accidents: extractAccidents(text),
		no_accidents: /No\s+(?:accidents?|damage)\s+(?:reported|found)/i.test(text),
		single_owner: ownerCount === 1,
		last_odometer: extractLastOdometer(text),
	};

	console.log('Extracted:', report);

	const res = await fetch(`${WORKER_URL}/api/import/carfax-report`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(report),
	});
	if (!res.ok) throw new Error(`Import POST failed: ${res.status} ${await res.text()}`);
	console.log('Imported successfully.');
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
