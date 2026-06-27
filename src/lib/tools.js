// AI tool definitions — OpenAI-compatible format (works with Groq)
export const TOOLS = [
  // ── Gmail ────────────────────────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'gmail_list_unread',
      description: 'List unread emails from Gmail inbox. Returns sender, subject, snippet, date.',
      parameters: {
        type: 'object',
        properties: {
          maxResults: { type: 'number', description: 'Max emails to return (default 5)' }
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'gmail_search',
      description: 'Search Gmail for emails. Supports Gmail search syntax.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Gmail search query e.g. "from:alice subject:meeting"' },
          maxResults: { type: 'number', description: 'Max results (default 5)' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'gmail_get_email',
      description: 'Get the full body of a specific email by its message ID.',
      parameters: {
        type: 'object',
        properties: {
          messageId: { type: 'string', description: 'Gmail message ID from a previous list/search' },
        },
        required: ['messageId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'gmail_send',
      description: 'Send an email via Gmail. ONLY call this after the operator has explicitly confirmed they want to send.',
      parameters: {
        type: 'object',
        properties: {
          to: { type: 'string', description: 'Recipient email address' },
          subject: { type: 'string', description: 'Email subject line' },
          body: { type: 'string', description: 'Email body text' },
          replyToId: { type: 'string', description: 'Optional message ID to reply to (for threading)' },
        },
        required: ['to', 'subject', 'body'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'gmail_create_draft',
      description: 'Create an email draft without sending it.',
      parameters: {
        type: 'object',
        properties: {
          to: { type: 'string' },
          subject: { type: 'string' },
          body: { type: 'string' },
        },
        required: ['to', 'subject', 'body'],
      },
    },
  },

  // ── Google Calendar ───────────────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'calendar_list_events',
      description: 'List Google Calendar events. Defaults to today if no time range given.',
      parameters: {
        type: 'object',
        properties: {
          timeMin: { type: 'string', description: 'ISO 8601 start (default: start of today)' },
          timeMax: { type: 'string', description: 'ISO 8601 end (default: end of today)' },
          maxResults: { type: 'number', description: 'Max events (default 10)' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'calendar_create_event',
      description: 'Create a new Google Calendar event.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          startTime: { type: 'string', description: 'ISO 8601 datetime' },
          endTime: { type: 'string', description: 'ISO 8601 datetime' },
          description: { type: 'string' },
          location: { type: 'string' },
        },
        required: ['title', 'startTime', 'endTime'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'calendar_delete_event',
      description: 'Delete a calendar event. ONLY call after explicit operator confirmation.',
      parameters: {
        type: 'object',
        properties: {
          eventId: { type: 'string', description: 'Calendar event ID from a previous list call' },
        },
        required: ['eventId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'calendar_update_event',
      description: 'Update an existing calendar event.',
      parameters: {
        type: 'object',
        properties: {
          eventId: { type: 'string' },
          title: { type: 'string' },
          startTime: { type: 'string', description: 'ISO 8601 datetime' },
          endTime: { type: 'string', description: 'ISO 8601 datetime' },
          description: { type: 'string' },
          location: { type: 'string' },
        },
        required: ['eventId'],
      },
    },
  },

  // ── Web Search ───────────────────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: 'Search the web for current information: news, sports scores, prices, events, facts. Use this for ANY real-time or recent information the operator asks about.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query — be specific and concise' },
        },
        required: ['query'],
      },
    },
  },

  // ── Notion ────────────────────────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'notion_search',
      description: 'Search the Notion workspace for pages and databases by name or content.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'notion_get_page',
      description: 'Get the content of a Notion page by its ID.',
      parameters: {
        type: 'object',
        properties: {
          pageId: { type: 'string', description: 'Notion page ID (with or without dashes)' },
        },
        required: ['pageId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'notion_create_page',
      description: 'Create a new Notion page as a child of an existing page.',
      parameters: {
        type: 'object',
        properties: {
          parentId: { type: 'string', description: 'Parent page ID' },
          title: { type: 'string', description: 'Page title' },
          content: { type: 'string', description: 'Initial page content (plain text)' },
        },
        required: ['parentId', 'title'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'notion_append_to_page',
      description: 'Append text content (notes, tasks) to an existing Notion page.',
      parameters: {
        type: 'object',
        properties: {
          pageId: { type: 'string', description: 'Notion page ID' },
          content: { type: 'string', description: 'Content to append' },
        },
        required: ['pageId', 'content'],
      },
    },
  },
]
