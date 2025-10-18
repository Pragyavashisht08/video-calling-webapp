import React from 'react'

export default function ChatPanel({ messages, onSend }) {
  const [text, setText] = React.useState('')
  const listRef = React.useRef(null)
  React.useEffect(() => {
    listRef.current?.scrollTo(0, listRef.current.scrollHeight)
  }, [messages])

  return (
    <div className="card" style={{minWidth: 320, maxWidth: 420}}>
      <h3>Chat</h3>
      <div className="chat" ref={listRef}>
        {messages.map(m => (
          <p key={m.id}><span className="badge">{m.displayName}</span> {m.text}</p>
        ))}
      </div>
      <div className="row" style={{marginTop: 8}}>
        <input placeholder="Type a message..." value={text} onChange={e => setText(e.target.value)} onKeyDown={(e) => e.key==='Enter' && (onSend(text), setText(''))} />
        <button className="btn" onClick={() => { onSend(text); setText('') }}>Send</button>
      </div>
    </div>
  )
}
