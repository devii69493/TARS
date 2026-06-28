import { useState, useCallback, useRef, useEffect } from 'react'
import { HUDCanvas } from './components/HUDCanvas'
import { SidePanel } from './components/SidePanel'
import { useSpeechRecognition } from './hooks/useSpeechRecognition'
import { useTTS } from './hooks/useTTS'
import { useAIChat } from './hooks/useAIChat'
import { useGoogleAuth } from './hooks/useGoogleAuth'
import { useToolExecutor } from './hooks/useToolExecutor'
import { useWakeWord, SLEEP_WORDS, matchWord } from './hooks/useWakeWord'
import { getApiKey } from './lib/aiConfig'
import { loadProfile, saveProfile, clearProfile } from './lib/readmeProfile'
import {
  loadMessages, saveMessages,
  loadHonesty,  saveHonesty,
  loadApiKey,   saveApiKey,
} from './lib/storage'

const LISTEN_DELAY = 650

let msgId = 0
const nextId = () => ++msgId

function hydrateMessages(msgs) {
  return msgs.map(m => ({ ...m, id: nextId() }))
}

// ── TARS voice lines ───────────────────────────────────────────────────────
const WAKE_LINES = [
  "Acknowledged.",
  "What do you need.",
  "I was wondering when you'd show up.",
  "On standby. What's the situation.",
  "Systems online.",
  "Signal received.",
  "Finally. What is it.",
  "I'm here. What do you need.",
]

const SLEEP_LINES = [
  "Understood. Shutting down.",
  "Finally.",
  "Going dark.",
  "Returning to standby.",
  "Acknowledged. Powering down.",
  "Noted. I'll be here.",
]

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)]

// Short-utterance sleep word check: prevent "send a goodbye email" from triggering sleep
function isSleepCommand(text) {
  const words = text.trim().split(/\s+/)
  const lower = text.toLowerCase()
  return words.length <= 5 && matchWord(lower, SLEEP_WORDS)
}

export default function App() {
  // ── Persisted state ────────────────────────────────────────────────────────
  const savedMessages                      = loadMessages()
  const [messages,     setMessages]        = useState(() => hydrateMessages(savedMessages))
  const [honesty,      setHonesty]         = useState(() => loadHonesty())
  const [apiKey,       setApiKey]          = useState(() => loadApiKey() || getApiKey() || '')

  // ── Ephemeral UI state ─────────────────────────────────────────────────────
  // 'standby' = wake word listening, 'idle'|'listening'|'processing'|'speaking' = active
  const [appState,      setAppState]       = useState('standby')
  const [interimText,   setInterimText]    = useState('')
  const [convMode,      setConvMode]       = useState(false)
  const [showSettings,  setShowSettings]   = useState(!apiKey)
  const [profile,       setProfile]        = useState(() => loadProfile())
  const [audioUnlocked, setAudioUnlocked]  = useState(false)

  const historyRef  = useRef(savedMessages.map(m => ({ role: m.role, content: m.content })))
  const convModeRef = useRef(false)

  useEffect(() => {
    if (messages.length > 0) saveMessages(messages)
  }, [messages])

  // ── Integrations ────────────────────────────────────────────────────────────
  const {
    connected: googleConnected, pending: googlePending, error: googleError,
    connect: connectGoogle, disconnect: disconnectGoogle, clientId: googleClientId,
  } = useGoogleAuth()

  const { executeTools } = useToolExecutor()
  const { sendMessage, error } = useAIChat({ honesty, apiKey, profile, toolExecutor: executeTools })
  const { speak, stop: stopSpeaking, unlock, isElevenLabs } = useTTS()

  const handleUnlock = useCallback(() => {
    unlock()
    setAudioUnlocked(true)
  }, [unlock])

  useEffect(() => { convModeRef.current = convMode }, [convMode])

  // ── Speech recognition (Whisper) ────────────────────────────────────────────
  const { isListening, isSupported, startListening, stopListening } = useSpeechRecognition({
    onResult:   handleUserSpeech,
    onInterim:  (t) => { setInterimText(t); setAppState('listening') },
    onNoSpeech: () => {
      if (convModeRef.current) {
        setTimeout(() => {
          if (!convModeRef.current) return
          startListening()
          setAppState('listening')
        }, 300)
      } else {
        setAppState('standby')
      }
    },
  })

  // ── Wake word detector (Web Speech API continuous, standby only) ────────────
  useWakeWord({
    onWake:  handleWakeWord,
    onSleep: handleSleepWord,
    enabled: !convMode && audioUnlocked,
  })

  function resumeListening() {
    if (!convModeRef.current) { setAppState('standby'); return }
    setTimeout(() => {
      if (!convModeRef.current) return
      startListening()
      setAppState('listening')
    }, LISTEN_DELAY)
  }

  // ── Wake word handler ───────────────────────────────────────────────────────
  function handleWakeWord() {
    if (convModeRef.current) return   // already active
    setConvMode(true)
    convModeRef.current = true
    setInterimText('')
    setAppState('speaking')
    speak(pick(WAKE_LINES), () => {
      if (!convModeRef.current) return
      startListening()
      setAppState('listening')
    })
  }

  // ── Sleep word handler (from wake-word hook, while convMode is false) ───────
  // This fires if the user says a sleep word while in standby — just ignore it.
  function handleSleepWord() { /* already in standby, nothing to do */ }

  // ── Core message handler ────────────────────────────────────────────────────
  function handleUserSpeech(transcript) {
    const text = transcript.trim()
    if (!text) { setAppState(convModeRef.current ? 'listening' : 'standby'); return }

    // Sleep word check — short utterances only to avoid "send a goodbye email" triggering this
    if (isSleepCommand(text)) {
      stopListening()
      setInterimText('')
      setAppState('speaking')
      const line = pick(SLEEP_LINES)
      speak(line, () => {
        setConvMode(false)
        convModeRef.current = false
        setAppState('standby')
      })
      // Add the exchange to history so it feels natural
      const userMsg = { role: 'user', content: text, id: nextId() }
      const tarsMsg = { role: 'assistant', content: line, id: nextId() }
      setMessages(prev => [...prev, userMsg, tarsMsg])
      historyRef.current = [...historyRef.current, { role: 'user', content: text }, { role: 'assistant', content: line }]
      return
    }

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
        resumeListening()
      }
    })()
  }

  // ── Conversation mode ───────────────────────────────────────────────────────
  // endConversation is kept for the manual override button
  const endConversation = useCallback(() => {
    setConvMode(false)
    convModeRef.current = false
    stopSpeaking()
    stopListening()
    setInterimText('')
    setAppState('standby')
  }, [stopSpeaking, stopListening])

  // ── Mic button — single-shot capture, available in standby ──────────────────
  const handleMicClick = () => {
    if (convMode) return
    if (appState === 'speaking')  { stopSpeaking(); setAppState('standby'); return }
    if (isListening)              { stopListening(); setAppState('standby') }
    else                          { startListening(); setAppState('listening') }
  }

  const handleTextSubmit = (e) => {
    e.preventDefault()
    const input = e.target.elements.textInput
    const text  = input.value.trim()
    if (!text) return
    input.value = ''
    // Text input activates conv mode for a single turn if not already active
    if (!convMode) {
      setConvMode(true)
      convModeRef.current = true
    }
    handleUserSpeech(text)
  }

  // ── Settings handlers ───────────────────────────────────────────────────────
  const handleHonestyChange = useCallback((val) => { setHonesty(val); saveHonesty(val) }, [])
  const handleApiKeyChange  = useCallback((key) => { setApiKey(key); saveApiKey(key); setShowSettings(false) }, [])
  const handleProfileLoad   = useCallback((text) => { saveProfile(text); setProfile(text) }, [])
  const handleProfileClear  = useCallback(() => { clearProfile(); setProfile('') }, [])

  return (
    <div className="app">
      {!audioUnlocked && (
        <div className="audio-gate">
          <div className="audio-gate-inner">
            <div className="audio-gate-id">T·A·R·S</div>
            <div className="audio-gate-sub">TACTICAL AUTONOMOUS RELAY SYSTEM</div>
            <div className="audio-gate-rule" />
            <div className="audio-gate-status">AWAITING OPERATOR AUTHORIZATION</div>
            <button className="audio-gate-btn" onClick={handleUnlock}>
              ▶ INITIALIZE UNIT
            </button>
            <div className="audio-gate-hint">click to enable audio · wake word: "TARS"</div>
          </div>
        </div>
      )}

      <div className="scanline" aria-hidden="true" />

      <div className="hud-area">
        <HUDCanvas
          state={appState}
          honesty={honesty}
          interimText={interimText}
          convMode={convMode}
        />

        <div className="mic-overlay">
          <div className={`listen-badge listen-badge--${appState}`}>
            {appState === 'listening'  ? '◉ LISTENING'        :
             appState === 'processing' ? '◈ PROCESSING'       :
             appState === 'speaking'   ? '◎ TRANSMITTING'     :
             appState === 'standby'    ? '⊙ SAY "TARS" TO WAKE' : ''}
          </div>

          {isElevenLabs && (
            <div className="voice-active-badge">◈ ELEVENLABS VOICE</div>
          )}

          {/* No START CONVERSATION button — wake words handle activation.
              END SESSION remains as a physical override. */}
          {convMode && (
            <button className="conv-btn conv-end" onClick={endConversation}>
              ■ END SESSION
            </button>
          )}

          <button
            className={[
              'mic-btn',
              isListening             ? 'active'       : '',
              appState === 'speaking' ? 'stop'         : '',
              convMode                ? 'conv-managed' : '',
            ].join(' ').trim()}
            onClick={handleMicClick}
            disabled={convMode || (!isSupported && appState === 'standby' && !isListening)}
            title={
              convMode                ? 'Session active — say a sleep word to end'  :
              appState === 'speaking' ? 'Stop transmission'                         :
              isListening             ? 'Stop listening'                            :
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
        onHonestyChange={handleHonestyChange}
        error={error}
        onSubmit={handleTextSubmit}
        disabled={appState === 'processing' || appState === 'speaking'}
        apiKey={apiKey}
        onApiKeyChange={handleApiKeyChange}
        showSettings={showSettings}
        onToggleSettings={() => setShowSettings(v => !v)}
        profile={profile}
        onProfileLoad={handleProfileLoad}
        onProfileClear={handleProfileClear}
        googleConnected={googleConnected}
        googlePending={googlePending}
        googleError={googleError}
        googleClientId={googleClientId}
        onGoogleConnect={connectGoogle}
        onGoogleDisconnect={disconnectGoogle}
      />
    </div>
  )
}
