import { useCallback, useEffect, useRef, useState } from 'react'

const AGENT_URL      = 'ws://localhost:7354'
const RECONNECT_MS   = 3000
const CALL_TIMEOUT   = 30000

export function useDesktopAgent() {
  const [connected, setConnected]   = useState(false)
  const wsRef       = useRef(null)
  const pendingRef  = useRef({})      // id → { resolve, reject, timer }
  const reconnRef   = useRef(null)
  const mountedRef  = useRef(true)

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return

    let ws
    try { ws = new WebSocket(AGENT_URL) } catch { return }
    wsRef.current = ws

    ws.onopen = () => {
      if (!mountedRef.current) return
      setConnected(true)
      clearTimeout(reconnRef.current)
    }

    ws.onmessage = ({ data }) => {
      try {
        const msg     = JSON.parse(data)
        const pending = pendingRef.current[msg.id]
        if (!pending) return
        clearTimeout(pending.timer)
        delete pendingRef.current[msg.id]
        if (msg.success) pending.resolve(msg.result)
        else             pending.reject(new Error(msg.error || 'Agent error'))
      } catch {}
    }

    ws.onclose = () => {
      wsRef.current = null
      if (!mountedRef.current) return
      setConnected(false)
      reconnRef.current = setTimeout(connect, RECONNECT_MS)
    }

    ws.onerror = () => ws.close()
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

  return { connected, call }
}
