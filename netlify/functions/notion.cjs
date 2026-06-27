// Notion API proxy — bypasses CORS restriction on direct browser requests
// Requires NOTION_API_KEY environment variable in Netlify dashboard (or .env.local for netlify dev)

exports.handler = async (event) => {
  const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  }

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS, body: '' }
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'Method not allowed' }) }
  }

  const key = process.env.NOTION_API_KEY
  if (!key) {
    return {
      statusCode: 503,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Notion API key not configured. Add NOTION_API_KEY to Netlify environment variables.' }),
    }
  }

  let path, method, body
  try {
    ;({ path, method, body } = JSON.parse(event.body || '{}'))
  } catch {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Invalid request body' }) }
  }

  if (!path) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Missing path' }) }
  }

  const url = `https://api.notion.com/v1${path}`
  const fetchOptions = {
    method: method || 'GET',
    headers: {
      Authorization:    `Bearer ${key}`,
      'Notion-Version': '2022-06-28',
      'Content-Type':   'application/json',
    },
  }
  if (body && method !== 'GET') {
    fetchOptions.body = JSON.stringify(body)
  }

  const res  = await fetch(url, fetchOptions)
  const data = await res.json()

  return {
    statusCode: res.status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  }
}
