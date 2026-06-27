// All Notion calls proxy through /.netlify/functions/notion (CORS workaround)
const PROXY = '/.netlify/functions/notion'

async function notionFetch(path, method = 'GET', body) {
  const res = await fetch(PROXY, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ path, method, body }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || `Notion error ${res.status}`)
  return data
}

function pageTitle(item) {
  return (
    item.properties?.title?.title?.[0]?.plain_text    ||
    item.properties?.Name?.title?.[0]?.plain_text     ||
    item.title?.[0]?.plain_text                        ||
    'Untitled'
  )
}

export async function searchNotion(query) {
  const data = await notionFetch('/search', 'POST', { query, page_size: 10 })
  return (data.results || []).map(item => ({
    id:    item.id,
    type:  item.object,
    title: pageTitle(item),
    url:   item.url,
  }))
}

export async function getNotionPage(pageId) {
  const clean  = pageId.replace(/-/g, '')
  const [page, blocks] = await Promise.all([
    notionFetch(`/pages/${clean}`),
    notionFetch(`/blocks/${clean}/children?page_size=100`),
  ])
  const content = (blocks.results || [])
    .map(b => (b[b.type]?.rich_text || []).map(rt => rt.plain_text).join(''))
    .filter(Boolean)
    .join('\n')
  return { id: clean, title: pageTitle(page), content }
}

export async function createNotionPage(parentId, title, content) {
  const clean    = parentId.replace(/-/g, '')
  const children = content
    ? content.split('\n').filter(Boolean).map(line => ({
        object: 'block',
        type:   'paragraph',
        paragraph: { rich_text: [{ type: 'text', text: { content: line } }] },
      }))
    : []
  return notionFetch('/pages', 'POST', {
    parent:     { page_id: clean },
    properties: { title: { title: [{ type: 'text', text: { content: title } }] } },
    children,
  })
}

export async function appendToNotionPage(pageId, content) {
  const clean    = pageId.replace(/-/g, '')
  const children = content.split('\n').filter(Boolean).map(line => ({
    object: 'block',
    type:   'paragraph',
    paragraph: { rich_text: [{ type: 'text', text: { content: line } }] },
  }))
  return notionFetch(`/blocks/${clean}/children`, 'PATCH', { children })
}
