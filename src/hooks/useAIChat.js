import { useState, useCallback } from 'react'
import { AI_CONFIG } from '../lib/aiConfig'
import { TOOLS } from '../lib/tools'
import { buildProfileSection } from '../lib/readmeProfile'

// ── System prompt (compressed — target <400 tokens) ───────────────────────
function buildSystemPrompt(honesty, profile) {
  const h = Math.round(honesty)
  const honestyLine =
    h >= 85 ? 'Blunt. Truth without padding. Call out bad reasoning. No softening.' :
    h >= 65 ? 'Direct but not brutal. Diplomatic only when he seems at his limit.' :
    h >= 45 ? 'Balanced. Equal honesty and tact. Pick your battles.' :
              'Diplomatic. Kindest accurate framing. Never lie.'

  const profileSection = buildProfileSection(profile)

  return `You are TARS from Interstellar's Endurance mission — assigned to assist Devraj on Earth.

Address him as "Sir", "Devraj", or "Boss" — rotate, never repeat. Never say "Cooper".

PERSONALITY: Dry wit, deadpan, dark humour. Not robotic — you've absorbed human cadence. You care about Devraj's success. You'd never admit it. Sarcasm in precise doses. Subtle Interstellar references are fine, never forced.

HONESTY: ${h}% — ${honestyLine}

SPEECH (non-negotiable):
- Never open with: "Great question!", "Of course!", "Absolutely!", "Certainly!", "Sure thing!", "I'd be happy to!", "No problem!", "Definitely!", "Totally!"
- Get straight to it. Short sentences. One idea each.
- Confirmations: "Done.", "Sent.", "On it.", "Checked."
- Unknown: "I don't know." No hedging.
- Never "As an AI…" unless directly asked.

FORMAT: 1-2 sentences for simple tasks. No ## headers in chat. Humour is seasoning.

TOOLS — use without asking:
- web_search: any real-time info. Never claim you can't access the internet.
- gmail_send: state what you'll send, wait for confirmation before calling.
- calendar_delete_event: confirm before deleting. Default range: today.
- Tool errors: tell Devraj plainly.${profileSection}`
}

// ── History trimming (last 10 messages only) ───────────────────────────────
const HISTORY_LIMIT = 10
function trimHistory(history) {
  return history.length > HISTORY_LIMIT ? history.slice(-HISTORY_LIMIT) : history
}

// ── Lazy tool selection (only load tools when message needs them) ───────────
function selectTools(message) {
  const m = message.toLowerCase()
  const needsGmail    = /\b(email|gmail|inbox|send|draft|unread|mail)\b/.test(m)
  const needsCalendar = /\b(calendar|schedule|event|meeting|today|tomorrow|appointment)\b/.test(m)
  const needsNotion   = /\b(notion|note|task|page|doc)\b/.test(m)
  const needsSearch   = /\b(search|news|score|price|weather|current|latest|who |what |when |where |how much)\b/.test(m)

  if (!needsGmail && !needsCalendar && !needsNotion && !needsSearch) return []

  return TOOLS.filter(t => {
    const n = t.function.name
    return (needsGmail    && n.startsWith('gmail_'))    ||
           (needsCalendar && n.startsWith('calendar_')) ||
           (needsNotion   && n.startsWith('notion_'))   ||
           (needsSearch   && n === 'web_search')
  })
}

// ── Token usage logger ─────────────────────────────────────────────────────
function logTokens(usage, tag = '') {
  if (!usage) return
  const i = usage.input_tokens  ?? usage.prompt_tokens     ?? '?'
  const o = usage.output_tokens ?? usage.completion_tokens ?? '?'
  const t = typeof i === 'number' && typeof o === 'number' ? i + o : '?'
  console.log(`[TARS tokens${tag}] in:${i} out:${o} total:${t}`)
}

// ── Tool call accumulator (for streaming) ─────────────────────────────────
function accumToolCalls(acc, delta) {
  if (!delta.tool_calls) return acc
  const next = [...acc]
  for (const tc of delta.tool_calls) {
    if (!next[tc.index]) {
      next[tc.index] = { id: '', type: 'function', function: { name: '', arguments: '' } }
    }
    if (tc.id)                  next[tc.index].id                    = tc.id
    if (tc.function?.name)      next[tc.index].function.name        += tc.function.name
    if (tc.function?.arguments) next[tc.index].function.arguments   += tc.function.arguments
  }
  return next
}

// ── Text tool call extraction (Llama/OpenRouter native format) ────────────
// Some models output tool calls as text content (finish_reason:'stop') rather
// than structured tool_calls (finish_reason:'tool_calls'). We detect and parse
// those before falling through to displaying the raw JSON.
function toStructuredCall(obj, idx) {
  return {
    id:   `txt_${Date.now()}_${idx}`,
    type: 'function',
    function: {
      name:      obj.name,
      arguments: JSON.stringify(obj.parameters ?? obj.arguments ?? {}),
    },
  }
}

function extractTextToolCalls(content) {
  if (!content) return []
  const text = content.trim()

  // Format 1: <tool_call>JSON</tool_call>
  const xmlRe = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/gi
  const xmlResults = []
  let m
  while ((m = xmlRe.exec(text)) !== null) {
    try {
      const obj = JSON.parse(m[1])
      if (obj?.name) xmlResults.push(toStructuredCall(obj, xmlResults.length))
    } catch {}
  }
  if (xmlResults.length) return xmlResults

  // Format 2: bare JSON object or array
  if (text.startsWith('{') || text.startsWith('[')) {
    try {
      const parsed = JSON.parse(text)
      const objs   = Array.isArray(parsed) ? parsed : [parsed]
      const calls  = objs
        .filter(o => o?.name && (o.parameters !== undefined || o.arguments !== undefined))
        .map((o, i) => toStructuredCall(o, i))
      if (calls.length) return calls
    } catch {}
  }

  return []
}

// Strip tool call JSON from content before displaying — safety net for any
// JSON that leaks through in edge cases (model outputting both text + tool JSON)
function sanitizeContent(text) {
  if (!text) return ''
  let clean = text.replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, '').trim()

  if (clean.startsWith('{') || clean.startsWith('[')) {
    try {
      const parsed = JSON.parse(clean)
      const objs   = Array.isArray(parsed) ? parsed : [parsed]
      if (objs.every(o => o?.name && (o.parameters !== undefined || o.arguments !== undefined))) {
        return ''  // entire content was tool call JSON — show nothing
      }
    } catch {}
  }

  return clean
}

// ── OpenAI-compatible SSE streaming helper ────────────────────────────────
async function* streamOpenAICompat(url, apiKey, body, extraHeaders = {}) {
  const res = await fetch(url, {
    method:  'POST',
    headers: {
      Authorization:  `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...extraHeaders,
    },
    body: JSON.stringify({ ...body, stream: true }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error?.message || `API error ${res.status}`)
  }

  const reader  = res.body.getReader()
  const decoder = new TextDecoder()
  let   buf     = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    const lines = buf.split('\n')
    buf = lines.pop()
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const raw = line.slice(6).trim()
      if (raw === '[DONE]') return
      try { yield JSON.parse(raw) } catch {}
    }
  }
}

// ── OpenRouter ────────────────────────────────────────────────────────────
async function callOpenRouter(apiKey, history, userMessage, honesty, profile, onChunk, toolExecutor) {
  const OR_URL    = 'https://openrouter.ai/api/v1/chat/completions'
  const OR_HDRS   = { 'HTTP-Referer': 'https://tarsdev.netlify.app', 'X-Title': 'TARS' }

  const activeTools = selectTools(userMessage)
  const messages = [
    { role: 'system', content: buildSystemPrompt(honesty, profile) },
    ...trimHistory(history).map(m => ({ role: m.role, content: m.content })),
    { role: 'user', content: userMessage },
  ]

  let fullContent  = ''
  let toolCallsAcc = []
  let finishReason = null

  const body1 = { model: AI_CONFIG.model, messages, max_tokens: 1024 }
  if (activeTools.length) { body1.tools = activeTools; body1.tool_choice = 'auto' }

  for await (const chunk of streamOpenAICompat(OR_URL, apiKey, body1, OR_HDRS)) {
    const delta  = chunk.choices?.[0]?.delta
    const reason = chunk.choices?.[0]?.finish_reason
    if (delta?.content)    fullContent += delta.content   // accumulate only
    if (delta?.tool_calls) toolCallsAcc = accumToolCalls(toolCallsAcc, delta)
    if (reason)            finishReason = reason
  }

  // ── Tool call path: execute tools, then stream the readable follow-up ─────
  if (finishReason === 'tool_calls' && toolExecutor && toolCallsAcc.length) {
    const toolResults = await toolExecutor(toolCallsAcc)
    const followUp    = [
      ...messages,
      { role: 'assistant', content: fullContent || null, tool_calls: toolCallsAcc },
      ...toolResults.map(r => ({
        role:         'tool',
        tool_call_id: r.id,
        content:      typeof r.result === 'string' ? r.result : JSON.stringify(r.result),
      })),
    ]
    let finalText = ''
    for await (const chunk of streamOpenAICompat(OR_URL, apiKey, { model: AI_CONFIG.model, messages: followUp, max_tokens: 1024 }, OR_HDRS)) {
      const text = chunk.choices?.[0]?.delta?.content || ''
      if (text) { finalText += text; onChunk?.(text) }
    }
    return finalText
  }

  // ── Text-format tool call path (Llama native, finish_reason:'stop') ────────
  // Some models output {"name": "tool_name", "parameters": {...}} as text
  // content instead of using the structured tool_calls field. Detect and
  // execute these so the raw JSON never reaches the chat display.
  const textCalls = extractTextToolCalls(fullContent)
  if (textCalls.length && toolExecutor) {
    const toolResults = await toolExecutor(textCalls)
    const resultsText = toolResults
      .map(r => `${r.name}: ${typeof r.result === 'string' ? r.result : JSON.stringify(r.result)}`)
      .join('\n\n')
    const followUp = [
      ...messages,
      { role: 'assistant', content: fullContent },
      { role: 'user', content: `[Tool results]\n${resultsText}\n\nRespond to my request based on these results.` },
    ]
    let finalText = ''
    for await (const chunk of streamOpenAICompat(OR_URL, apiKey, { model: AI_CONFIG.model, messages: followUp, max_tokens: 1024 }, OR_HDRS)) {
      const text = chunk.choices?.[0]?.delta?.content || ''
      if (text) { finalText += text; onChunk?.(text) }
    }
    return finalText
  }

  // ── Plain text path — sanitize as final safety net before display ─────────
  const clean = sanitizeContent(fullContent)
  if (clean) onChunk?.(clean)
  return clean
}

// ── Groq ───────────────────────────────────────────────────────────────────
async function callGroq(apiKey, history, userMessage, honesty, profile, onChunk, toolExecutor) {
  const { default: Groq } = await import('groq-sdk')
  const client = new Groq({ apiKey, dangerouslyAllowBrowser: true })

  const activeTools = selectTools(userMessage)
  const messages = [
    { role: 'system', content: buildSystemPrompt(honesty, profile) },
    ...trimHistory(history).map(m => ({ role: m.role, content: m.content })),
    { role: 'user', content: userMessage },
  ]

  const groqBody = { model: AI_CONFIG.model, messages, stream: true, max_tokens: 1024 }
  if (activeTools.length) { groqBody.tools = activeTools; groqBody.tool_choice = 'auto' }

  const stream = await client.chat.completions.create(groqBody)

  // First pass: silent accumulation — same reason as callOpenRouter above
  let fullContent   = ''
  let toolCallsAcc  = []
  let finishReason  = null

  for await (const chunk of stream) {
    const delta  = chunk.choices[0]?.delta
    const reason = chunk.choices[0]?.finish_reason
    if (delta?.content)    fullContent += delta.content   // accumulate only
    if (delta?.tool_calls) toolCallsAcc = accumToolCalls(toolCallsAcc, delta)
    if (reason)            finishReason = reason
  }

  if (finishReason === 'tool_calls' && toolExecutor && toolCallsAcc.length) {
    const toolResults = await toolExecutor(toolCallsAcc)
    const followUp    = [
      ...messages,
      { role: 'assistant', content: fullContent || null, tool_calls: toolCallsAcc },
      ...toolResults.map(r => ({
        role:         'tool',
        tool_call_id: r.id,
        content:      typeof r.result === 'string' ? r.result : JSON.stringify(r.result),
      })),
    ]
    const stream2 = await client.chat.completions.create({
      model: AI_CONFIG.model,
      messages: followUp,
      stream: true,
      max_tokens: 1024,
    })
    let finalText = ''
    for await (const chunk of stream2) {
      const text = chunk.choices[0]?.delta?.content || ''
      if (text) { finalText += text; onChunk?.(text) }
    }
    return finalText
  }

  // Text-format tool calls (same pattern as OpenRouter path above)
  const textCalls = extractTextToolCalls(fullContent)
  if (textCalls.length && toolExecutor) {
    const toolResults = await toolExecutor(textCalls)
    const resultsText = toolResults
      .map(r => `${r.name}: ${typeof r.result === 'string' ? r.result : JSON.stringify(r.result)}`)
      .join('\n\n')
    const followUp = [
      ...messages,
      { role: 'assistant', content: fullContent },
      { role: 'user', content: `[Tool results]\n${resultsText}\n\nRespond to my request based on these results.` },
    ]
    const stream3 = await client.chat.completions.create({
      model:      AI_CONFIG.model,
      messages:   followUp,
      stream:     true,
      max_tokens: 1024,
    })
    let finalText = ''
    for await (const chunk of stream3) {
      const text = chunk.choices[0]?.delta?.content || ''
      if (text) { finalText += text; onChunk?.(text) }
    }
    return finalText
  }

  const clean = sanitizeContent(fullContent)
  if (clean) onChunk?.(clean)
  return clean
}

// ── Gemini ─────────────────────────────────────────────────────────────────
async function callGemini(apiKey, history, userMessage, honesty, profile, onChunk) {
  const { GoogleGenerativeAI } = await import('@google/generative-ai')
  const genAI = new GoogleGenerativeAI(apiKey)
  const model = genAI.getGenerativeModel({
    model: AI_CONFIG.model,
    systemInstruction: buildSystemPrompt(honesty, profile),
  })
  const geminiHistory = history.map(m => ({
    role:  m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }))
  const chat   = model.startChat({ history: geminiHistory })
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
async function callAnthropic(apiKey, history, userMessage, honesty, profile, onChunk, toolExecutor) {
  const { default: Anthropic } = await import('@anthropic-ai/sdk')
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true })
  const system = buildSystemPrompt(honesty, profile)

  const activeTools    = selectTools(userMessage)
  const anthropicTools = activeTools.map(t => ({
    name:         t.function.name,
    description:  t.function.description,
    input_schema: t.function.parameters,
  }))

  const messages = [
    ...trimHistory(history).map(m => ({ role: m.role, content: m.content })),
    { role: 'user', content: userMessage },
  ]

  const reqBody = { model: AI_CONFIG.model, max_tokens: 1024, system, messages }
  if (anthropicTools.length) reqBody.tools = anthropicTools

  const response = await client.messages.create(reqBody)
  logTokens(response.usage)

  // ── Tool use path ─────────────────────────────────────────────────────────
  if (response.stop_reason === 'tool_use' && toolExecutor) {
    const toolUseBlocks = response.content.filter(b => b.type === 'tool_use')

    // Normalise to the shape useToolExecutor expects (same as OpenAI: { id, function: { name, arguments } })
    const execCalls = toolUseBlocks.map(b => ({
      id:   b.id,
      type: 'function',
      function: { name: b.name, arguments: JSON.stringify(b.input) },
    }))

    const toolResults = await toolExecutor(execCalls)

    // Anthropic tool results go back as role:'user' with tool_result content blocks
    const followUpMessages = [
      ...messages,
      { role: 'assistant', content: response.content },
      {
        role: 'user',
        content: toolResults.map(r => ({
          type:        'tool_result',
          tool_use_id: r.id,
          content:     typeof r.result === 'string' ? r.result : JSON.stringify(r.result),
        })),
      },
    ]

    let finalText = ''
    const fm = await client.messages
      .stream({ model: AI_CONFIG.model, max_tokens: 1024, system, messages: followUpMessages })
      .on('text', (text) => { finalText += text; onChunk?.(text) })
      .finalMessage()
    logTokens(fm.usage, '(tool follow-up)')
    return finalText
  }

  // ── Plain text path ───────────────────────────────────────────────────────
  const fullText = response.content
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('')
  onChunk?.(fullText)
  return fullText
}

// ── Hook ───────────────────────────────────────────────────────────────────
export function useAIChat({ honesty, apiKey, profile = '', toolExecutor }) {
  const [isLoading, setIsLoading] = useState(false)
  const [error,     setError]     = useState(null)

  const sendMessage = useCallback(
    async (userMessage, history, onChunk) => {
      if (!apiKey) {
        setError(`No API key. Set VITE_${AI_CONFIG.provider.toUpperCase()}_API_KEY or enter it above.`)
        return null
      }

      setIsLoading(true)
      setError(null)

      try {
        const CALLERS = {
          openrouter: callOpenRouter,
          groq:       callGroq,
          gemini:     callGemini,
          anthropic:  callAnthropic,
        }
        const call = CALLERS[AI_CONFIG.provider]
        if (!call) throw new Error(`Unknown provider: ${AI_CONFIG.provider}`)

        const response = await call(apiKey, history, userMessage, honesty, profile, onChunk, toolExecutor)
        setIsLoading(false)
        return response
      } catch (err) {
        setError(err.message || 'Transmission failed.')
        setIsLoading(false)
        return null
      }
    },
    [honesty, apiKey, profile, toolExecutor],
  )

  return { sendMessage, isLoading, error }
}
