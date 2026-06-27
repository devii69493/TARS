import { useState, useCallback } from 'react'
import { connectGoogle as gConnect, isGoogleConnected, disconnectGoogle } from '../lib/googleAuth'

export function useGoogleAuth() {
  // isGoogleConnected() already reflects the localStorage-restored token because
  // googleAuth.js restores it at module load time, before this hook runs.
  const [connected, setConnected] = useState(() => isGoogleConnected())
  const [error,     setError]     = useState(null)
  const [pending,   setPending]   = useState(false)
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID

  const connect = useCallback(async () => {
    setError(null)
    setPending(true)
    try {
      await gConnect()
      setConnected(true)
    } catch (err) {
      const msg = err.message || 'Authorization failed'
      if (!msg.includes('access_denied') && !msg.includes('popup_closed')) {
        setError(msg)
      }
      setConnected(false)
    } finally {
      setPending(false)
    }
  }, [])

  const disconnect = useCallback(() => {
    disconnectGoogle()
    setConnected(false)
    setError(null)
  }, [])

  return { connected, error, pending, connect, disconnect, clientId }
}
