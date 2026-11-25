/**
 * Unified AI text generation for Muxamil.co (server-side only).
 *
 * Provider chain (first success wins):
 *   1. Google Gemini — powered by the site's own AI API key (AI_API_KEY —
 *      REQUIRED environment variable; never hard-code credentials in source).
 *      Configurable model via AI_MODEL (default: gemini-3.6-flash).
 *   2. z-ai-web-dev-sdk — automatic fallback for environments where the
 *      Gemini API is unreachable (e.g. unsupported source regions) so AI
 *      features never go dark.
 *
 * NEVER import this module from client components — it holds credentials.
 */

const GEMINI_API_KEY = process.env.AI_API_KEY || ''

const GEMINI_MODEL = process.env.AI_MODEL || 'gemini-3.6-flash'

const GEMINI_URL = (model: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`

/** Hard timeout so a stuck provider quickly yields to the fallback. */
const GEMINI_TIMEOUT_MS = 45_000

export type AiResult = {
  text: string
  /** Which provider produced the text — surfaced for admin transparency. */
  provider: 'gemini' | 'zai'
}

export type AiRequest = {
  system: string
  prompt: string
  /** Soft cap on output length (characters) applied to whichever provider wins. */
  maxChars?: number
}

function clamp(text: string, maxChars?: number): string {
  const t = text.trim()
  return maxChars && t.length > maxChars ? `${t.slice(0, maxChars)}…` : t
}

/** Call Google Gemini generateContent with the site AI key. Throws on any failure. */
async function geminiGenerate(req: AiRequest): Promise<string> {
  if (!GEMINI_API_KEY) throw new Error('Gemini key not configured (AI_API_KEY)')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS)
  try {
    const res = await fetch(GEMINI_URL(GEMINI_MODEL), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': GEMINI_API_KEY,
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: req.system }] },
        contents: [{ role: 'user', parts: [{ text: req.prompt }] }],
        generationConfig: { temperature: 0.7, maxOutputTokens: 1024 },
      }),
      signal: controller.signal,
    })
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw new Error(`Gemini HTTP ${res.status}: ${detail.slice(0, 300)}`)
    }
    const data = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[]
    }
    const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? ''
    if (!text.trim()) throw new Error('Gemini returned an empty candidate.')
    return text
  } finally {
    clearTimeout(timer)
  }
}

/** Fallback provider — sandbox-friendly LLM via z-ai-web-dev-sdk. */
async function zaiGenerate(req: AiRequest): Promise<string> {
  const { default: ZAI } = await import('z-ai-web-dev-sdk')
  const zai = await ZAI.create()
  const completion = await zai.chat.completions.create({
    messages: [
      { role: 'system', content: req.system },
      { role: 'user', content: req.prompt },
    ],
    thinking: { type: 'disabled' },
  })
  const text = completion.choices[0]?.message?.content ?? ''
  if (!text.trim()) throw new Error('z-ai returned an empty completion.')
  return text
}

/**
 * Generate text through the provider chain. Throws only when BOTH providers
 * fail — callers should map the failure to a friendly 502.
 */
export async function aiGenerate(req: AiRequest): Promise<AiResult> {
  const errors: string[] = []

  try {
    const text = await geminiGenerate(req)
    return { text: clamp(text, req.maxChars), provider: 'gemini' }
  } catch (err) {
    errors.push(`gemini: ${err instanceof Error ? err.message : String(err)}`)
  }

  try {
    const text = await zaiGenerate(req)
    return { text: clamp(text, req.maxChars), provider: 'zai' }
  } catch (err) {
    errors.push(`zai: ${err instanceof Error ? err.message : String(err)}`)
  }

  throw new Error(`All AI providers failed — ${errors.join(' | ')}`)
}
