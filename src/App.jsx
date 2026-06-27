import { useState, useCallback, useRef, useEffect } from 'react'
import { HUDCanvas } from './components/HUDCanvas'
import { SidePanel } from './components/SidePanel'
import { useSpeechRecognition } from './hooks/useSpeechRecognition'
import { useElevenLabsTTS } from './hooks/useElevenLabsTTS'
import { useAIChat } from './hooks/useAIChat'
import { getApiKey } from './lib/aiConfig'

// Gap between TARS finishing speech and mic opening — avoids catching TTS audio tail.
const LISTEN_DELAY = 650

let msgId = 0
const nextId = () => ++msgId

export default function App() {
  const [messages,     setMessages]     = useState([])
  const [honesty,      setHonesty]      = useState(90)
  const [appState,     setAppState]     = useState('idle')
  const [interimText,  setInterimText]  = useState('')
  const [convMode,     setConvMode]     = useState(false)
  const [apiKey,       setApiKey]       = useState(getApiKey() || '')
  const [showKeyInput, setShowKeyInput] = useState(!getApiKey())
  const historyRef  = useRef([])
  const convModeRef = useRef(false)  // stable ref — safe to read inside async/timer callbacks

  const { sendMessage, error } = useAIChat({ honesty, apiKey })
  const { speak, stop: stopSpeaking } = useElevenLabsTTS()

  // Keep ref in sync so any closure always sees the current value
  useEffect(() => { convModeRef.current = convMode }, [convMode])

  // ── Speech recognition (startListening is now stable — no stale-closure risk) ──
  const { isListening, isSupported, startListening, stopListening } = useSpeechRecognition({
    onResult:  handleUserSpeech,
    onInterim: (t) => { setInterimText(t); setAppState('listening') },
    // Called on no-speech timeout OR any non-abort recognition error
    onNoSpeech: () => {
      if (convModeRef.current) {
        // Stay alive: brief pause then re-open the mic
        setTimeout(() => {
          if (!convModeRef.current) return
          startListening()
          setAppState('listening')
        }, 300)
      } else {
        setAppState('idle')
      }
    },
  })

  // Shared helper: re-open the mic after TARS finishes speaking (or after an error)
  function resumeListening() {
    if (!convModeRef.current) { setAppState('idle'); return }
    setTimeout(() => {
      if (!convModeRef.current) return
      startListening()
      setAppState('listening')
    }, LISTEN_DELAY)
  }

  // ── Core: send a transcript to the AI ────────────────────────────────────
  function handleUserSpeech(transcript) {
    const text = transcript.trim()
    if (!text) { setAppState('idle'); return }

    setInterimText('')
    setAppState('processing')

    const userMsg     = { role: 'user',      content: text, id: nextId() }
    const assistantId = nextId()
    const placeholder = { role: 'assistant', content: '',   id: assistantId, streaming: true }

    setMessages(prev => [...prev, userMsg, placeholder])
    historyRef.current = [...historyRef.current, { role: 'user', content: text }]

    ;(async () => {
      let accumulated = ''
      const response = await sendMessage(
        text,
        historyRef.current.slice(0, -1),
        (chunk) => {
          accumulated += chunk
          setMessages(prev =>
            prev.map(m => m.id === assistantId ? { ...m, content: accumulated } : m)
          )
        }
      )

      setMessages(prev =>
        prev.map(m =>
          m.id === assistantId
            ? { ...m, streaming: false, content: response || '[Signal lost]' }
            : m
        )
      )

      if (response) {
        historyRef.current = [...historyRef.current, { role: 'assistant', content: response }]
        setAppState('speaking')
        speak(response, resumeListening)
      } else {
        // API error — resume listening so conversation doesn't die
        resumeListening()
      }
    })()
  }

  // ── Conversation mode controls ────────────────────────────────────────────
  const startConversation = useCallback(() => {
    setConvMode(true)
    convModeRef.current = true
    startListening()
    setAppState('listening')
  }, [startListening])

  const endConversation = useCallback(() => {
    setConvMode(false)
    convModeRef.current = false
    stopSpeaking()
    stopListening()
    setInterimText('')
    setAppState('idle')
  }, [stopSpeaking, stopListening])

  // ── Single-shot mic button ────────────────────────────────────────────────
  const handleMicClick = () => {
    if (convMode) return
    if (appState === 'speaking')  { stopSpeaking(); setAppState('idle'); return }
    if (isListening)              { stopListening(); setAppState('idle') }
    else if (appState === 'idle') { startListening(); setAppState('listening') }
  }

  // ── Text input (single-shot only) ────────────────────────────────────────
  const handleTextSubmit = async (e) => {
    e.preventDefault()
    const input = e.target.elements.textInput
    const text  = input.value.trim()
    if (!text || appState !== 'idle' || convMode) return
    input.value = ''
    handleUserSpeech(text)
  }

  return (
    <div className="app">
      <div className="scanline" aria-hidden="true" />

      <div className="hud-area">
        <HUDCanvas
          state={appState}
          honesty={honesty}
          interimText={interimText}
          convMode={convMode}
        />

        <div className="mic-overlay">
          {convMode ? (
            <button className="conv-btn conv-end" onClick={endConversation}>
              ■ END SESSION
            </button>
          ) : (
            <button
              className="conv-btn conv-start"
              onClick={startConversation}
              disabled={appState !== 'idle' || !isSupported}
              title={!isSupported ? 'Requires Chrome or Edge' : 'Start continuous conversation'}
            >
              ▶ START CONVERSATION
            </button>
          )}

          <button
            className={[
              'mic-btn',
              isListening             ? 'active'       : '',
              appState === 'speaking' ? 'stop'         : '',
              convMode               ? 'conv-managed'  : '',
            ].join(' ').trim()}
            onClick={handleMicClick}
            disabled={convMode || (!isSupported && appState === 'idle' && !isListening)}
            title={
              convMode                ? 'Managed by conversation session' :
              appState === 'speaking' ? 'Stop transmission'               :
              isListening             ? 'Stop listening'                  :
                                        'Single transmission'
            }
          >
            {appState === 'speaking' ? '■' : isListening ? '◉' : '◎'}
          </button>

          {!isSupported && <span className="mic-warn">USE CHROME</span>}
        </div>
      </div>

      <SidePanel
        messages={messages}
        interimText={interimText}
        honesty={honesty}
        onHonestyChange={setHonesty}
        error={error}
        onSubmit={handleTextSubmit}
        disabled={appState !== 'idle' || convMode}
        apiKey={apiKey}
        onApiKeyChange={(key) => { setApiKey(key); setShowKeyInput(false) }}
        showKeyInput={showKeyInput}
        onToggleKeyInput={() => setShowKeyInput(v => !v)}
      />
    </div>
  )
}
