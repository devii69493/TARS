const TAVILY_KEY = import.meta.env.VITE_TAVILY_API_KEY || ''

export async function webSearch(query) {
  if (!query?.trim()) throw new Error('Search query is empty')

  const res = await fetch('/.netlify/functions/search', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ query: query.trim(), apiKey: TAVILY_KEY }),
  })

  const data = await res.json()

  if (!res.ok) {
    throw new Error(data.error || `Search error ${res.status}`)
  }

  const { results = [] } = data
  if (!results.length) return 'No results found.'

  return results
    .map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.description}`)
    .join('\n\n')
}
