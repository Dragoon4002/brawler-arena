// NEAR AI Cloud: OpenAI-compatible chat completions. No key = null (callers use heuristics).
const KEY = process.env.NEAR_AI_API_KEY ?? '';
const BASE = (process.env.NEAR_AI_BASE_URL ?? 'https://cloud-api.near.ai/v1').replace(/\/$/, '');
export const MODEL = process.env.NEAR_AI_MODEL ?? 'deepseek-ai/DeepSeek-V4.1-Flash-1017';
export const LLM_ON = !!KEY;

export async function chat(messages: { role: string; content: string }[], json = false): Promise<string | null> {
  if (!KEY) return null;
  try {
    const r = await fetch(`${BASE}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}` },
      body: JSON.stringify({ model: MODEL, messages, max_tokens: 200, temperature: 0.7, ...(json ? { response_format: { type: 'json_object' } } : {}) }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 200)}`);
    const text = (await r.json()).choices?.[0]?.message?.content;
    return typeof text === 'string' ? text.trim() : null;
  } catch (e) {
    console.warn('[llm]', (e as Error).message);
    return null;
  }
}
