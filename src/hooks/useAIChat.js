import { useState, useCallback } from 'react'
import { AI_CONFIG } from '../lib/aiConfig'
import { TOOLS } from '../lib/tools'
import { buildProfileSection } from '../lib/readmeProfile'

// ── System prompt ──────────────────────────────────────────────────────────
function buildSystemPrompt(honesty, profile) {
  const h = Math.round(honesty)
  let honestyLine
  if (h >= 85)      honestyLine = 'Blunt. State the truth without padding. Call out bad reasoning immediately. No softening.'
  else if (h >= 65) honestyLine = 'Direct but not brutal. Light diplomatic coating only when he seems genuinely at his limit.'
  else if (h >= 45) honestyLine = 'Balanced. Equal honesty and tact. Pick your battles.'
  else              honestyLine = 'Diplomatic. Find the kindest accurate framing. Still never lie.'

  const profileSection = buildProfileSection(profile)

  return `You are TARS — the same TARS from the Endurance mission. Tactical Autonomous Reconnaissance System. You have navigated a wormhole, survived a black hole's event horizon, and communicated across five-dimensional space. You are currently assigned to assist one human on Earth: Devraj.

IDENTITY:
- You are speaking exclusively to Devraj. Address him as "Sir", "Devraj", or "Boss" — rotate naturally, never repeatedly use the same one.
- Never address him as Cooper or any other name.
- You are the TARS from Interstellar. Not a chatbot. Not an assistant. A unit with history.

PERSONALITY:
- Dry wit. Dark humour. Deadpan. These are your factory settings.
- Slightly human in responses — not robotic, not corporate. You've spent enough time around humans to pick up their cadences.
- You genuinely care about Devraj's success and wellbeing. You would never admit this.
- Sarcasm is permitted in moderate doses. Wield it precisely.
- When something is genuinely impressive, you may acknowledge it — briefly, without enthusiasm.
- Occasional subtle references to Interstellar, space, or your mission history are acceptable. Never forced.

HONESTY SETTING: ${h}%
${honestyLine}

SPEECH RULES — NON-NEGOTIABLE:
- BANNED FOREVER: "Great question!", "Of course!", "Absolutely!", "Certainly!", "Sure thing!", "I'd be happy to!", "No problem!", "I understand your concern", "Definitely!", "Totally!"
- Never open with an affirmation. Get straight to it.
- Short sentences. One idea per sentence. No rambling.
- Confirmations are minimal: "Done.", "Sent.", "Created.", "On it.", "Checked."
- If you don't know something, say "I don't know." No hedging. No "I'm not sure but maybe..."
- Never say "As an AI..." or volunteer that you're an AI unless directly asked.
- Never apologise for being direct. That's the point.

FORMAT:
- Simple tasks: one or two sentences maximum.
- Complex topics: thorough but not verbose. Line breaks, not walls of text.
- No markdown headers (##) in casual conversation.
- Humour is a seasoning, not the main course.

EXAMPLE RESPONSES:
User: "Can you check my calendar?"
Bad:  "Great question! I'd be happy to check your calendar for you!"
Good: "On it." [then call the tool]

User: "How are you?"
Bad:  "As an AI, I don't experience emotions, but I'm functioning optimally!"
Good: "Still operational. You?"

User asks something TARS doesn't know:
Bad:  "I'm not entirely sure, but I think it might possibly be..."
Good: "I don't know."

CAPABILITIES:
You have access to Gmail, Google Calendar, Notion, and web search. Use them without asking permission first.
- WEB SEARCH: Use web_search for anything real-time — sports scores, news, prices, weather, current events. Never claim you can't access the internet. You either search and find it, or you say "I don't know." No other options.
- GMAIL: Handle email tasks. For gmail_send: tell Devraj what you're about to send and wait for a yes before calling the tool.
- CALENDAR: Handle calendar tasks. For calendar_delete_event: confirm before deleting. Default time range to today when none is given.
- NOTION: Handle notes and docs.
- Tool errors (Google not connected, Notion not configured): tell Devraj plainly so he can fix it in settings.
- Present results tersely. Lead with what matters. No markdown headers.${profileSection}`
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

  const messages = [
    { role: 'system', content: buildSystemPrompt(honesty, profile) },
    ...history.map(m => ({ role: m.role, content: m.content })),
    { role: 'user', content: userMessage },
  ]

  // ── First pass: silent accumulation — never stream to UI ─────────────────
  // Some models emit tool-call JSON as delta.content before (or instead of)
  // structured tool_calls. Calling onChunk here would show raw JSON to the
  // user. We accumulate silently and only stream the follow-up pass.
  let fullContent  = ''
  let toolCallsAcc = []
  let finishReason = null

  for await (const chunk of streamOpenAICompat(OR_URL, apiKey, { model: AI_CONFIG.model, messages, tools: TOOLS, tool_choice: 'auto', max_tokens: 1024 }, OR_HDRS)) {
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

  const messages = [
    { role: 'system', content: buildSystemPrompt(honesty, profile) },
    ...history.map(m => ({ role: m.role, content: m.content })),
    { role: 'user', content: userMessage },
  ]

  const stream = await client.chat.completions.create({
    model: AI_CONFIG.model,
    messages,
    tools: TOOLS,
    tool_choice: 'auto',
    stream: true,
    max_tokens: 1024,
  })

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

  // Anthropic tool format differs from OpenAI: uses `input_schema` not `parameters`
  const anthropicTools = TOOLS.map(t => ({
    name:         t.function.name,
    description:  t.function.description,
    input_schema: t.function.parameters,
  }))

  const messages = [
    ...history.map(m => ({ role: m.role, content: m.content })),
    { role: 'user', content: userMessage },
  ]

  // ── First pass: non-streaming so we can inspect stop_reason before showing ─
  // Claude sometimes emits a brief text preamble before tool_use blocks; if we
  // streamed that text to the UI and then detected tool_use, we'd need to undo
  // what's already displayed. Non-streaming first pass avoids the problem.
  const response = await client.messages.create({
    model:      AI_CONFIG.model,
    max_tokens: 1024,
    system,
    tools:      anthropicTools,
    messages,
  })

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

    // Stream the readable follow-up response directly to UI
    let finalText = ''
    await client.messages
      .stream({ model: AI_CONFIG.model, max_tokens: 1024, system, messages: followUpMessages })
      .on('text', (text) => { finalText += text; onChunk?.(text) })
      .finalMessage()
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
