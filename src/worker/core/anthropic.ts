// DriveIQ Cloud — Anthropic Messages API client
// Non-streaming; mirrors social/src/core/llm.ts's callAnthropic, minus the
// Ollama fallback (no local-LLM concept in the Workers architecture).

import type { Env } from '../env.js';

export interface AnthropicContentBlock {
	type: 'text' | 'tool_use' | 'tool_result';
	text?: string;
	id?: string;
	name?: string;
	input?: Record<string, unknown>;
	tool_use_id?: string;
	content?: string;
}

export interface LLMMessage {
	role: 'user' | 'assistant';
	content: string | AnthropicContentBlock[];
}

export interface AnthropicTool {
	name: string;
	description: string;
	input_schema: Record<string, unknown>;
}

export interface AnthropicResponse {
	content: AnthropicContentBlock[];
	stop_reason: string;
}

async function callAnthropic(
	env: Env,
	opts: { system: string; messages: LLMMessage[]; tools?: AnthropicTool[]; maxTokens?: number }
): Promise<AnthropicResponse> {
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
			...(opts.tools ? { tools: opts.tools } : {}),
		}),
	});

	if (!res.ok) {
		const body = await res.text().catch(() => '');
		throw new Error(`Anthropic ${res.status}: ${body.slice(0, 200)}`);
	}

	return (await res.json()) as AnthropicResponse;
}

function extractText(content: AnthropicContentBlock[]): string {
	return content
		.filter((b) => b.type === 'text')
		.map((b) => b.text ?? '')
		.join('');
}

export async function generate(env: Env, opts: { system: string; messages: LLMMessage[]; maxTokens?: number }): Promise<string> {
	const data = await callAnthropic(env, opts);
	return extractText(data.content);
}

// Tool-capable variant — returns the raw response so the caller can inspect
// stop_reason/content for tool_use blocks and drive its own execute + follow-
// up round trip (the tool's actual side effect, e.g. a DB write, belongs to
// the route calling this, not this client).
export async function generateWithTools(
	env: Env,
	opts: { system: string; messages: LLMMessage[]; tools: AnthropicTool[]; maxTokens?: number }
): Promise<AnthropicResponse> {
	return callAnthropic(env, opts);
}

export { extractText };
