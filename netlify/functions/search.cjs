// Brave Search API proxy — keeps the API key off the client bundle.
// Accepts POST { query: string, apiKey?: string }
// Uses SEARCH_API_KEY env var first (Netlify dashboard), falls back to client-provided key.
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

  const key = process.env.SEARCH_API_KEY || clientKey
  if (!key) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'No search API key configured. Set SEARCH_API_KEY in Netlify env vars.' }),
    }
  }

  if (!query?.trim()) {
    return { statusCode: 400, body: JSON.stringify({ error: 'query is required' }) }
  }

  try {
    const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=6&text_decorations=false`
    const res = await fetch(url, {
      headers: {
        Accept:               'application/json',
        'Accept-Encoding':    'gzip',
        'X-Subscription-Token': key,
      },
    })

    const data = await res.json()

    if (!res.ok) {
      return {
        statusCode: res.status,
        body: JSON.stringify({ error: data.message || `Brave API error ${res.status}` }),
      }
    }

    // Return only what TARS needs — title, url, description for each result
    const results = (data.web?.results || []).map(r => ({
      title:       r.title,
      url:         r.url,
      description: r.description || '',
    }))

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
