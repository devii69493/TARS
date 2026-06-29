// Tavily Search API proxy — keeps the key off the client bundle.
// Accepts POST { query: string, apiKey?: string }
// Uses TAVILY_API_KEY env var first (Netlify dashboard), falls back to client key.
exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' }
  }

  let query, clientKey
  try {
    ;({ query, apiKey: clientKey } = JSON.parse(event.body))
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON body' }) }
  }

  const key = process.env.TAVILY_API_KEY || clientKey
  if (!key) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'No search API key. Set TAVILY_API_KEY in Netlify env vars.' }),
    }
  }

  if (!query?.trim()) {
    return { statusCode: 400, body: JSON.stringify({ error: 'query is required' }) }
  }

  try {
    const res = await fetch('https://api.tavily.com/search', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key:        key,
        query:          query.trim(),
        search_depth:   'basic',
        max_results:    5,
        include_answer: true,
      }),
    })

    const data = await res.json()

    if (!res.ok) {
      return {
        statusCode: res.status,
        body: JSON.stringify({ error: data.error?.message || `Tavily error ${res.status}` }),
      }
    }

    const results = (data.results || []).map(r => ({
      title:       r.title,
      url:         r.url,
      description: (r.content || r.snippet || '').slice(0, 220),
    }))

    // Prepend Tavily's synthesised direct answer when present
    if (data.answer) {
      results.unshift({ title: 'Direct answer', url: '', description: data.answer })
    }

    return {
      statusCode: 200,
      headers:    { 'Content-Type': 'application/json' },
      body:       JSON.stringify({ results }),
    }
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    }
  }
}
