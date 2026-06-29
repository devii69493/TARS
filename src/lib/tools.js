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

]

// ── Desktop tools (only injected when agent is connected) ─────────────────
export const DESKTOP_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'desktop_app_open',
      description: 'Open a macOS app by name.',
      parameters: { type: 'object', properties: { name: { type: 'string', description: 'e.g. "Safari", "Spotify", "Finder"' } }, required: ['name'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'desktop_app_close',
      description: 'Quit a running macOS app.',
      parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'desktop_app_switch',
      description: 'Switch focus to a running macOS app.',
      parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'desktop_app_list',
      description: 'List all currently running macOS apps.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'desktop_screenshot',
      description: 'Take a screenshot of the current screen. Returns base64 PNG.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'desktop_media',
      description: 'Control Apple Music or Spotify playback.',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['play_pause', 'next', 'prev', 'current'], description: 'current = get now playing info' },
        },
        required: ['action'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'desktop_volume',
      description: 'Get or set system volume, or mute/unmute.',
      parameters: {
        type: 'object',
        properties: {
          level: { type: 'number', description: '0–100. Omit to get current level.' },
          mute:  { type: 'boolean', description: 'true = mute, false = unmute. Omit to skip.' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'desktop_file_open',
      description: 'Open a file or URL with its default app.',
      parameters: { type: 'object', properties: { path: { type: 'string', description: 'File path or URL' } }, required: ['path'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'desktop_spotlight',
      description: 'Search files on this Mac using Spotlight (mdfind).',
      parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'desktop_dnd',
      description: 'Enable or disable Do Not Disturb / Focus mode.',
      parameters: { type: 'object', properties: { enabled: { type: 'boolean' } }, required: ['enabled'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'desktop_battery',
      description: 'Get battery level and charging status.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'desktop_lock',
      description: 'Lock the screen.',
      parameters: { type: 'object', properties: {} },
    },
  },
  // ── Spotify ──────────────────────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'desktop_spotify',
      description: 'Control Spotify. action: play, pause, next, prev, current, search. For search include query.',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['play', 'pause', 'next', 'prev', 'current', 'search'] },
          query:  { type: 'string', description: 'Search query (artist, track, album). Required for action=search.' },
          volume: { type: 'number', description: 'Set Spotify volume 0–100. Omit for other actions.' },
        },
        required: ['action'],
      },
    },
  },
  // ── YouTube via yt-dlp + VLC ──────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'desktop_youtube',
      description: 'Stream YouTube via VLC. action: play (needs query), pause, resume, stop. Use for "play X on YouTube".',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['play', 'pause', 'resume', 'stop'] },
          query:  { type: 'string', description: 'Search query. Required for action=play.' },
        },
        required: ['action'],
      },
    },
  },
  // ── Window management ─────────────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'desktop_window',
      description: 'Manage the frontmost window: fullscreen, minimize, restore, snap left/right, resize, move to next monitor.',
      parameters: {
        type: 'object',
        properties: {
          action:    { type: 'string', enum: ['fullscreen', 'unfullscreen', 'minimize', 'restore', 'snap_left', 'snap_right', 'resize', 'move_monitor'] },
          width:     { type: 'number', description: 'Width in pixels (resize only)' },
          height:    { type: 'number', description: 'Height in pixels (resize only)' },
        },
        required: ['action'],
      },
    },
  },
  // ── Brightness ────────────────────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'desktop_brightness',
      description: 'Set or adjust screen brightness. level: 0.0–1.0. delta: change by amount (e.g. 0.1 = brighter, -0.1 = dimmer).',
      parameters: {
        type: 'object',
        properties: {
          level: { type: 'number', description: 'Absolute brightness 0.0–1.0' },
          delta: { type: 'number', description: 'Relative change (e.g. 0.2 or -0.2)' },
        },
      },
    },
  },
  // ── Timer ─────────────────────────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'desktop_timer',
      description: 'Set a countdown timer. Works everywhere — uses browser notifications, no agent required. Always call this for any timer request.',
      parameters: {
        type: 'object',
        properties: {
          seconds: { type: 'number', description: 'Duration in seconds' },
          label:   { type: 'string',  description: 'Label shown in notification' },
        },
        required: ['seconds'],
      },
    },
  },
]
