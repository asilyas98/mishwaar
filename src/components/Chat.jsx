import { useEffect, useRef, useState } from 'react'

const time = (iso) => new Date(iso).toLocaleTimeString('ar-YE', { hour: 'numeric', minute: '2-digit' })

export default function Chat({ user, messages, otherName, disabled, onSend }) {
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const list = useRef(null)

  useEffect(() => {
    if (list.current) list.current.scrollTop = list.current.scrollHeight
  }, [messages.length])

  async function send(e) {
    e.preventDefault()
    const body = text.trim()
    if (!body) return
    setSending(true)
    try { await onSend(body); setText('') } finally { setSending(false) }
  }

  return (
    <section className="chat" aria-label={`المحادثة مع ${otherName}`}>
      <h3>المحادثة مع {otherName}</h3>
      <ol className="chat-list" ref={list}>
        {messages.length === 0 && <li className="chat-empty muted">لا رسائل بعد. اكتب لتنسيق مكان اللقاء.</li>}
        {messages.map((m) => (
          <li key={m.id} className={m.kind === 'system' ? 'msg sys' : m.senderId === user.id ? 'msg me' : 'msg them'}>
            <span className="msg-body">{m.body}</span>
            <time className="msg-time">{time(m.createdAt)}</time>
          </li>
        ))}
      </ol>
      {!disabled && (
        <form className="chat-form" onSubmit={send}>
          <input id="chat-input" value={text} onChange={(e) => setText(e.target.value)} placeholder="اكتب رسالة…" maxLength={500} autoComplete="off" aria-label="رسالة" />
          <button className="btn primary" disabled={sending || !text.trim()}>أرسل</button>
        </form>
      )}
    </section>
  )
}
