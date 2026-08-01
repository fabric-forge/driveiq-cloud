// DriveIQ Cloud — Aiana document ingestion (one-off, run locally)
//
// Extracts text from the owner's manual / QRG / CARFAX report / maintenance
// audit PDFs, chunks it (500 chars, 50 overlap, word-boundary aware — mirrors
// the reference ry-ops/DriveIQ scripts/ingest_documents.py), and POSTs each
// document's chunks to a locally-running `wrangler dev` instance, which does
// the actual embedding (Workers AI binding) + Qdrant upsert server-side.
//
// Run:
//   1. In one terminal: npx wrangler dev
//   2. In another:      node scripts/ingest.mjs
//
// These PDFs contain real PI — never commit them or their extracted text.

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

const CHUNK_SIZE = 500;
const CHUNK_OVERLAP = 50;
const WORKER_URL = process.env.WORKER_URL ?? 'http://localhost:8787';
const BATCH = 20;

function chunkText(text, chunkSize = CHUNK_SIZE, overlap = CHUNK_OVERLAP) {
	const words = text.split(/\s+/).filter(Boolean);
	const chunks = [];
	let current = [];
	let currentLength = 0;

	for (const word of words) {
		if (currentLength + word.length + 1 > chunkSize && current.length > 0) {
			chunks.push(current.join(' '));
			let overlapWords = [];
			let overlapLength = 0;
			for (let i = current.length - 1; i >= 0; i--) {
				const w = current[i];
				if (overlapLength + w.length + 1 > overlap) break;
				overlapWords.unshift(w);
				overlapLength += w.length + 1;
			}
			current = overlapWords;
			currentLength = overlapLength;
		}
		current.push(word);
		currentLength += word.length + 1;
	}
	if (current.length > 0) chunks.push(current.join(' '));
	return chunks;
}

async function ingestDocument({ file, name }) {
	const path = `${DOCS_DIR}/${file}`;
	console.log(`\nParsing ${name} (${path})...`);
	const buffer = await readFile(path);
	const parser = new PDFParse({ data: buffer });
	const result = await parser.getText();
	await parser.destroy();

	const pages = Array.isArray(result.pages) && result.pages.length > 0 ? result.pages : null;
	const chunks = [];
	if (pages) {
		for (let i = 0; i < pages.length; i++) {
			const pageText = pages[i].text ?? '';
			if (!pageText.trim()) continue;
			for (const content of chunkText(pageText)) {
				chunks.push({ content, page_number: i + 1 });
			}
		}
	} else {
		for (const content of chunkText(result.text ?? '')) {
			chunks.push({ content, page_number: null });
		}
	}
	chunks.forEach((ch, i) => (ch.chunk_index = i));

	console.log(`  ${chunks.length} chunks. Posting to ${WORKER_URL} for embedding + upsert...`);
	for (let i = 0; i < chunks.length; i += BATCH) {
		const batch = chunks.slice(i, i + BATCH);
		const res = await fetch(`${WORKER_URL}/api/search/ingest`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ document_name: name, chunks: batch }),
		});
		if (!res.ok) {
			throw new Error(`Ingest POST failed: ${res.status} ${await res.text()}`);
		}
		process.stdout.write(`  ${Math.min(i + BATCH, chunks.length)}/${chunks.length}\r`);
	}
	console.log(`  Done: ${chunks.length} chunks ingested for "${name}".`);
}

async function main() {
	for (const doc of DOCUMENTS) {
		await ingestDocument(doc);
	}
	console.log('\nAll documents ingested.');
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
