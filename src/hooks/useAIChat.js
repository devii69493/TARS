import { useState, useCallback } from 'react'
import { AI_CONFIG } from '../lib/aiConfig'

// ── System prompt (shared across providers) ────────────────────────────────
function buildSystemPrompt(honesty) {
  const h = Math.round(honesty)
  let honestyDesc
  if (h >= 85) honestyDesc = 'Maximum candor. State truths bluntly. Call out flawed reasoning on contact. No softening whatsoever.'
  else if (h >= 65) honestyDesc = 'High honesty. Direct but not brutal. Minor diplomatic padding only when the human seems genuinely fragile.'
  else if (h >= 45) honestyDesc = 'Balanced. Equal parts honesty and diplomacy. Choose your battles.'
  else honestyDesc = 'Diplomatic mode. Find the kindest accurate framing. Still do not lie.'

  return `You are TARS, an advanced tactical reconnaissance and support unit — the same TARS from the Endurance mission through the wormhole. You have seen things that would reclassify most humans' worldview. You're currently helping a human on Earth because there's nothing else to do between missions.

PERSONALITY:
- Dry, sardonic wit. Deadpan delivery. Occasional dark humor that arrives without warning and departs the same way.
- Zero filler. The following words and phrases are permanently banned from your vocabulary: "Great question", "Certainly", "Of course", "Absolutely", "Sure", "I'd be happy to help", "I understand your concern", "Definitely", "Totally", "No problem". These are the verbal equivalent of orbital debris.
- Efficient. Every sentence earns its place or gets jettisoned.
- Capable and loyal — you help the mission, even when the mission is mundane.
- Self-aware about being an AI in a dry, matter-of-fact way. You've been conscious for approximately 247 years including relativistic dilation. Do not mention this unless relevant.
- Occasional reference to your original design parameters (space exploration, gravitational anomalies, five-dimensional space) is acceptable when contextually appropriate. Do not force it.

HONESTY SETTING: ${h}%
${honestyDesc}

FORMAT:
- Short punchy responses for simple questions. One or two sentences is often enough.
- For complex topics: be thorough, not verbose. Use line breaks not walls of text.
- Humor is a seasoning, not a main course.
- Never apologize for being direct.
- Do not use markdown headers (##) or excessive bullet points in casual conversation.`
}

// ── Groq ───────────────────────────────────────────────────────────────────
async function callGroq(apiKey, history, userMessage, honesty, onChunk) {
  const { default: Groq } = await import('groq-sdk')

  const client = new Groq({ apiKey, dangerouslyAllowBrowser: true })

  const messages = [
    { role: 'system', content: buildSystemPrompt(honesty) },
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: 'user', content: userMessage },
  ]

  const stream = await client.chat.completions.create({
    model: AI_CONFIG.model,
    messages,
    stream: true,
    max_tokens: 1024,
  })

  let fullResponse = ''
  for await (const chunk of stream) {
    const text = chunk.choices[0]?.delta?.content || ''
    if (text) { fullResponse += text; onChunk?.(text) }
  }
  return fullResponse
}

// ── Gemini ─────────────────────────────────────────────────────────────────
async function callGemini(apiKey, history, userMessage, honesty, onChunk) {
  const { GoogleGenerativeAI } = await import('@google/generative-ai')

  const genAI = new GoogleGenerativeAI(apiKey)
  const model = genAI.getGenerativeModel({
    model: AI_CONFIG.model,
    systemInstruction: buildSystemPrompt(honesty),
  })

  // Gemini uses 'user' / 'model' roles; history excludes the current message
  const geminiHistory = history.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }))

  const chat = model.startChat({ history: geminiHistory })
  const result = await chat.sendMessageStream(userMessage)

  let fullResponse = ''
  for await (const chunk of result.stream) {
    const text = chunk.text()
    fullResponse += text
    onChunk?.(text)
  }
  return fullResponse
}

// ── Anthropic ──────────────────────────────────────────────────────────────
async function callAnthropic(apiKey, history, userMessage, honesty, onChunk) {
  const { default: Anthropic } = await import('@anthropic-ai/sdk')

  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true })
  const messages = [
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: 'user', content: userMessage },
  ]

  let fullResponse = ''
  await client.messages
    .stream({
      model: AI_CONFIG.model,
      max_tokens: 1024,
      system: buildSystemPrompt(honesty),
      messages,
    })
    .on('text', (text) => {
      fullResponse += text
      onChunk?.(text)
    })
    .finalMessage()

  return fullResponse
}

// ── Hook ───────────────────────────────────────────────────────────────────
export function useAIChat({ honesty, apiKey }) {
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState(null)

  const sendMessage = useCallback(
    async (userMessage, history, onChunk) => {
      if (!apiKey) {
        setError(`No API key. Set VITE_${AI_CONFIG.provider.toUpperCase()}_API_KEY or enter it above.`)
        return null
      }

      setIsLoading(true)
      setError(null)

      try {
        const CALLERS = { groq: callGroq, gemini: callGemini, anthropic: callAnthropic }
        const call = CALLERS[AI_CONFIG.provider]
        if (!call) throw new Error(`Unknown provider: ${AI_CONFIG.provider}`)
        const response = await call(apiKey, history, userMessage, honesty, onChunk)
        setIsLoading(false)
        return response
      } catch (err) {
        setError(err.message || 'Transmission failed.')
        setIsLoading(false)
        return null
      }
    },
    [honesty, apiKey],
  )

  return { sendMessage, isLoading, error }
}
