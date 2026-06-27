import { useEffect, useRef } from 'react'

function Message({ msg }) {
  const isUser = msg.role === 'user'
  return (
    <div className={`message ${isUser ? 'message-user' : 'message-tars'}`}>
      <span className="message-sender">{isUser ? 'COOPER' : 'TARS'}</span>
      <span className="message-text">
        {msg.content || (msg.streaming ? <span className="cursor-blink">▋</span> : '…')}
        {msg.streaming && msg.content && <span className="cursor-blink">▋</span>}
      </span>
    </div>
  )
}

export function ChatLog({ messages, interimText }) {
  const bottomRef = useRef(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, interimText])

  return (
    <div className="chat-log">
      {messages.length === 0 && (
        <div className="chat-empty">
          Awaiting transmission.
        </div>
      )}
      {messages.map((m) => (
        <Message key={m.id} msg={m} />
      ))}
      {interimText && (
        <div className="message message-user interim">
          <span className="message-sender">COOPER</span>
          <span className="message-text">{interimText}<span className="cursor-blink">▋</span></span>
        </div>
      )}
      <div ref={bottomRef} />
    </div>
  )
}
