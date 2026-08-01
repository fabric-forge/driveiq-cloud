// DriveIQ Cloud — Aiana page-image ingestion (one-off, run locally)
//
// Renders each page of the owner's manual / QRG / CARFAX report /
// maintenance audit to PNG (thumbnail + fullsize, mirrors the reference
// ry-ops/DriveIQ page_images.py's two sizes) and PUTs each to a locally
// running `wrangler dev` instance, which stores them in R2.
//
// Run:
//   1. In one terminal: npx wrangler dev
//   2. In another:      node scripts/ingest-images.mjs
//
// These PDFs contain real PI — never commit them or the rendered images.

import { readFile } from 'node:fs/promises';
import { PDFParse } from 'pdf-parse';

const DOCS_DIR = `${process.env.HOME}/Desktop/4runner`;
const DOCUMENTS = [
	{ file: '4Runner Manual.pdf', name: "Owner's Manual" },
	{ file: '4Runner QRG.pdf', name: 'Quick Reference Guide' },
	{
		file: 'CARFAX Vehicle History Report for this 2018 TOYOTA 4RUNNER SR5 PREMIUM_ JTEBU5JR2J5517128.pdf',
		name: 'CARFAX Vehicle History Report',
	},
	{ file: '2018_Toyota_4Runner_Maintenance_Report.pdf', name: 'Maintenance Audit Report' },
];

const WORKER_URL = process.env.WORKER_URL ?? 'http://localhost:8787';
const BATCH_PAGES = 10; // pages rendered per getScreenshot() call, bounds memory use

async function putImage(documentName, page, variant, buffer, retries = 3) {
	const url = `${WORKER_URL}/api/pages/ingest/${encodeURIComponent(documentName)}/${page}/${variant}`;
	for (let attempt = 1; attempt <= retries; attempt++) {
		const res = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'image/png' }, body: buffer });
		if (res.ok) return;
		const body = await res.text().catch(() => '');
		if (attempt === retries) throw new Error(`PUT ${url} failed: ${res.status} ${body}`);
		await new Promise((r) => setTimeout(r, 500 * attempt));
	}
}

async function renderDocument({ file, name }) {
	const path = `${DOCS_DIR}/${file}`;
	console.log(`\nRendering ${name} (${path})...`);
	const buffer = await readFile(path);

	// Discover page count once.
	const textParser = new PDFParse({ data: buffer });
	const textResult = await textParser.getText();
	await textParser.destroy();
	const totalPages = textResult.pages.length;
	console.log(`  ${totalPages} pages, in batches of ${BATCH_PAGES}...`);

	for (let start = 1; start <= totalPages; start += BATCH_PAGES) {
		const pageNumbers = [];
		for (let p = start; p < start + BATCH_PAGES && p <= totalPages; p++) pageNumbers.push(p);

		const parser = new PDFParse({ data: buffer });
		const thumbs = await parser.getScreenshot({ partial: pageNumbers, desiredWidth: 300 });
		const fulls = await parser.getScreenshot({ partial: pageNumbers, desiredWidth: 1200 });
		await parser.destroy();

		for (let i = 0; i < pageNumbers.length; i++) {
			const page = pageNumbers[i];
			await putImage(name, page, 'thumbnail', thumbs.pages[i].data);
			await putImage(name, page, 'full', fulls.pages[i].data);
		}
		process.stdout.write(`  ${Math.min(start + BATCH_PAGES - 1, totalPages)}/${totalPages}\r`);
	}
	console.log(`  Done: ${totalPages} pages rendered for "${name}".`);
}

async function main() {
	for (const doc of DOCUMENTS) {
		await renderDocument(doc);
	}
	console.log('\nAll documents rendered.');
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
