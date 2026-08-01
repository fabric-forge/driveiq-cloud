// DriveIQ Cloud — Anthropic Messages API client
// Non-streaming; mirrors social/src/core/llm.ts's callAnthropic, minus the
// Ollama fallback (no local-LLM concept in the Workers architecture).

import type { Env } from '../env.js';

export interface LLMMessage {
	role: 'user' | 'assistant';
	content: string;
}

export async function generate(env: Env, opts: { system: string; messages: LLMMessage[]; maxTokens?: number }): Promise<string> {
	const res = await fetch('https://api.anthropic.com/v1/messages', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'x-api-key': env.ANTHROPIC_API_KEY,
			'anthropic-version': '2023-06-01',
		},
		body: JSON.stringify({
			model: env.CLAUDE_MODEL,
			max_tokens: opts.maxTokens ?? 600,
			system: opts.system,
			messages: opts.messages,
		}),
	});

	if (!res.ok) {
		const body = await res.text().catch(() => '');
		throw new Error(`Anthropic ${res.status}: ${body.slice(0, 200)}`);
	}

	const data = (await res.json()) as { content: Array<{ type: string; text: string }> };
	return data.content
		.filter((b) => b.type === 'text')
		.map((b) => b.text)
		.join('');
}
