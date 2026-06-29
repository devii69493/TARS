import { useCallback, useEffect, useRef, useState } from 'react'

const DEFAULT_AGENT_URL = 'ws://localhost:7354'
function getAgentUrl() {
  return localStorage.getItem('tars_agent_url') || DEFAULT_AGENT_URL
}
const RECONNECT_MS   = 3000
const CALL_TIMEOUT   = 30000

export function useDesktopAgent() {
  const [connected, setConnected]   = useState(false)
  const wsRef        = useRef(null)
  const pendingRef   = useRef({})      // id → { resolve, reject, timer }
  const reconnRef    = useRef(null)
  const mountedRef   = useRef(true)
  const hotwordCbRef = useRef(null)    // callback fired on hotword message

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return

    let ws
    try { ws = new WebSocket(getAgentUrl()) } catch { return }
    wsRef.current = ws

    ws.onopen = () => {
      console.log('[TARS agent] WebSocket connected')
      if (!mountedRef.current) return
      setConnected(true)
      clearTimeout(reconnRef.current)
    }

    ws.onmessage = ({ data }) => {
      try {
        const msg = JSON.parse(data)
        // Server-push: hotword detected
        if (msg.type === 'hotword') {
          hotwordCbRef.current?.()
          return
        }
        const pending = pendingRef.current[msg.id]
        if (!pending) return
        clearTimeout(pending.timer)
        delete pendingRef.current[msg.id]
        if (msg.success) pending.resolve(msg.result)
        else             pending.reject(new Error(msg.error || 'Agent error'))
      } catch {}
    }

    ws.onclose = (e) => {
      console.log('[TARS agent] WebSocket closed', e.code, e.reason)
      wsRef.current = null
      if (!mountedRef.current) return
      setConnected(false)
      reconnRef.current = setTimeout(connect, RECONNECT_MS)
    }

    ws.onerror = (e) => {
      console.log('[TARS agent] WebSocket error', e)
      ws.close()
    }
  }, [])

  useEffect(() => {
    mountedRef.current = true
    connect()
    return () => {
      mountedRef.current = false
      clearTimeout(reconnRef.current)
      wsRef.current?.close()
    }
  }, [connect])

  // call(tool, args) → Promise<result>
  const call = useCallback((tool, args = {}) => {
    return new Promise((resolve, reject) => {
      const ws = wsRef.current
      console.log('[TARS agent] call:', tool, '| ws readyState:', ws?.readyState, '| OPEN=', WebSocket.OPEN)
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        reject(new Error('Desktop agent offline. Run start-tars.sh first.'))
        return
      }
      const id    = crypto.randomUUID()
      const timer = setTimeout(() => {
        delete pendingRef.current[id]
        reject(new Error(`Agent timeout: ${tool}`))
      }, CALL_TIMEOUT)
      pendingRef.current[id] = { resolve, reject, timer }
      ws.send(JSON.stringify({ id, tool, args }))
    })
  }, [])

  const onHotword = useCallback((cb) => { hotwordCbRef.current = cb }, [])

  const setAgentUrl = useCallback((url) => {
    const clean = url.trim()
    if (clean) localStorage.setItem('tars_agent_url', clean)
    else        localStorage.removeItem('tars_agent_url')
    // Force reconnect with new URL
    wsRef.current?.close()
  }, [])

  return { connected, call, onHotword, setAgentUrl }
}
