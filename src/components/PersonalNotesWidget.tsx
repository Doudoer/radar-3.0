import React, { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../services/apiFetch';

export const PersonalNotesWidget: React.FC = () => {
  type MessageUser = { id: number; name: string; email: string };
  type Message = { id: number; subject: string; content: string; read_at: string | null; created_at: string; sender_name: string; recipient_name: string };
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'notes' | 'messages'>('notes');
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<'idle' | 'saved' | 'error'>('idle');
  const [loaded, setLoaded] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [messageUsers, setMessageUsers] = useState<MessageUser[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [messageLoading, setMessageLoading] = useState(false);
  const [messagesLoaded, setMessagesLoaded] = useState(false);
  const [recipientId, setRecipientId] = useState('');
  const [subject, setSubject] = useState('');
  const [messageContent, setMessageContent] = useState('');
  const [messageStatus, setMessageStatus] = useState<'idle' | 'sent' | 'error'>('idle');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!open || loaded || loading) return;
    setLoading(true);
    apiFetch('/me/notes')
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((payload) => {
        setContent(payload.content || '');
        setLoaded(true);
        setDirty(false);
      })
      .catch(() => setStatus('error'))
      .finally(() => setLoading(false));
  }, [open, loaded, loading]);

  useEffect(() => {
    if (open) window.setTimeout(() => textareaRef.current?.focus(), 0);
  }, [open]);

  useEffect(() => {
    if (!open || !loaded || !dirty) return;
    const timer = window.setTimeout(() => {
      void save();
    }, 700);
    return () => window.clearTimeout(timer);
  }, [content, dirty, loaded, open]);

  useEffect(() => {
    if (!open || tab !== 'messages' || messageLoading || messagesLoaded) return;
    setMessageLoading(true);
    Promise.all([
      apiFetch('/me/message-users').then((response) => response.ok ? response.json() : Promise.reject()),
      apiFetch('/me/messages').then((response) => response.ok ? response.json() : Promise.reject()),
    ])
      .then(([users, inbox]) => { setMessageUsers(users); setMessages(inbox); setMessagesLoaded(true); })
      .catch(() => setMessageStatus('error'))
      .finally(() => setMessageLoading(false));
  }, [open, tab, messageLoading, messagesLoaded]);

  const save = async () => {
    setSaving(true);
    setStatus('idle');
    try {
      const response = await apiFetch('/me/notes', {
        method: 'PUT',
        body: JSON.stringify({ content }),
      });
      if (!response.ok) throw new Error('No se pudo guardar el bloc de notas.');
      setDirty(false);
      setStatus('saved');
    } catch {
      setStatus('error');
    } finally {
      setSaving(false);
    }
  };

  const close = async () => {
    if (dirty) await save();
    setOpen(false);
  };

  const sendMessage = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!recipientId || !messageContent.trim()) return;
    setMessageStatus('idle');
    try {
      const response = await apiFetch('/me/messages', { method: 'POST', body: JSON.stringify({ recipientId, subject, content: messageContent }) });
      if (!response.ok) throw new Error('No se pudo enviar el mensaje.');
      setMessageContent('');
      setSubject('');
      setMessageStatus('sent');
      setMessageLoading(false);
    } catch {
      setMessageStatus('error');
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => { setStatus('idle'); setLoaded(false); setMessagesLoaded(false); setOpen(true); }}
        title="Abrir bloc de notas personal"
        aria-label="Abrir bloc de notas personal"
        className="fixed bottom-5 right-5 z-[80] flex h-12 items-center gap-2 rounded-full border border-[#3b82f6]/50 bg-[#13233c] px-4 text-[#8dbbff] shadow-[0_8px_28px_rgba(0,0,0,0.35)] transition hover:border-[#58a6ff] hover:bg-[#1d3559] hover:text-white"
      >
        <span className="material-symbols-outlined">edit_note</span>
        <span className="text-xs font-semibold">Bloc de notas</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-[80] pointer-events-none">
          <div className="pointer-events-auto absolute bottom-5 right-5 flex h-[min(620px,calc(100vh-2.5rem))] w-[min(420px,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-[#2b466e] bg-[#0d1728] shadow-[0_18px_70px_rgba(0,0,0,0.58)]">
            <div className="flex items-start justify-between border-b border-[#1e293b] bg-[#111f35] px-4 py-3">
              <div>
                <h2 className="flex items-center gap-2 text-sm font-bold text-[#f1f5f9]"><span className="material-symbols-outlined text-[19px] text-[#58a6ff]">edit_note</span>Bloc de notas personal</h2>
                <p className="mt-1 text-[11px] text-[#94a3b8]">Tus apuntes privados están disponibles sobre cualquier vista.</p>
              </div>
              <button type="button" onClick={() => void close()} aria-label="Cerrar bloc de notas" className="rounded-lg p-1 text-[#94a3b8] hover:bg-[#1e293b] hover:text-white"><span className="material-symbols-outlined text-[19px]">close</span></button>
            </div>
            <div className="flex border-b border-[#1e293b] px-3 pt-2">
              <button type="button" onClick={() => setTab('notes')} className={`border-b-2 px-3 py-2 text-xs font-semibold ${tab === 'notes' ? 'border-[#58a6ff] text-[#8dbbff]' : 'border-transparent text-[#94a3b8]'}`}>Mis notas</button>
              <button type="button" onClick={() => setTab('messages')} className={`border-b-2 px-3 py-2 text-xs font-semibold ${tab === 'messages' ? 'border-[#58a6ff] text-[#8dbbff]' : 'border-transparent text-[#94a3b8]'}`}>Mensajes</button>
            </div>
            {tab === 'notes' ? <div className="flex flex-1 flex-col p-3">
              <textarea
                ref={textareaRef}
                value={content}
                onChange={(event) => { setContent(event.target.value); setDirty(true); setStatus('idle'); }}
                placeholder={loading ? 'Cargando tus apuntes...' : 'Escribe aquí una nota rápida...'}
                disabled={loading}
                className="min-h-0 flex-1 resize-none rounded-xl border border-[#263653] bg-[#080d19] p-3 text-sm leading-6 text-[#e2e8f0] outline-none placeholder:text-[#64748b] focus:border-[#58a6ff]"
              />
            </div> : <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
              <form onSubmit={sendMessage} className="flex flex-col gap-2 rounded-xl border border-[#263653] bg-[#111f35] p-3">
                <select value={recipientId} onChange={(event) => setRecipientId(event.target.value)} className="rounded-lg border border-[#263653] bg-[#080d19] px-3 py-2 text-xs text-white outline-none focus:border-[#58a6ff]" required>
                  <option value="">Seleccionar usuario...</option>
                  {messageUsers.map((user) => <option key={user.id} value={user.id}>{user.name} · {user.email}</option>)}
                </select>
                <input value={subject} onChange={(event) => setSubject(event.target.value)} placeholder="Asunto (opcional)" className="rounded-lg border border-[#263653] bg-[#080d19] px-3 py-2 text-xs text-white outline-none focus:border-[#58a6ff]" />
                <textarea value={messageContent} onChange={(event) => setMessageContent(event.target.value)} placeholder="Escribe un mensaje rápido..." rows={3} className="resize-none rounded-lg border border-[#263653] bg-[#080d19] px-3 py-2 text-xs leading-5 text-white outline-none focus:border-[#58a6ff]" required />
                <button type="submit" className="self-end rounded-lg bg-[#388bfd] px-3 py-2 text-xs font-bold text-[#07111f] hover:bg-[#58a6ff]">Enviar mensaje</button>
                {messageStatus === 'sent' && <span className="text-[11px] text-[#6ee7b7]">Mensaje enviado</span>}
                {messageStatus === 'error' && <span className="text-[11px] text-[#fca5a5]">No se pudo cargar o enviar el mensaje</span>}
              </form>
              <div className="flex flex-col gap-2">
                {messageLoading && <p className="text-xs text-[#94a3b8]">Cargando mensajes...</p>}
                {!messageLoading && messages.length === 0 && <p className="text-xs text-[#64748b]">Aún no tienes mensajes.</p>}
                {messages.map((message) => <article key={message.id} className={`rounded-xl border p-3 ${message.read_at ? 'border-[#263653] bg-[#080d19]' : 'border-[#388bfd]/50 bg-[#13233c]'}`}><div className="flex justify-between gap-2"><strong className="text-xs text-[#f1f5f9]">{message.subject || 'Mensaje interno'}</strong><time className="text-[10px] text-[#64748b]">{new Date(message.created_at).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' })}</time></div><p className="mt-1 text-[11px] text-[#94a3b8]">De {message.sender_name} · Para {message.recipient_name}</p><p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-[#cbd5e1]">{message.content}</p></article>)}
              </div>
            </div>}
            {tab === 'notes' && <div className="flex items-center justify-between border-t border-[#1e293b] px-4 py-3">
              <span className={`text-[11px] ${status === 'error' ? 'text-[#fca5a5]' : status === 'saved' ? 'text-[#6ee7b7]' : 'text-[#64748b]'}`}>
                {status === 'error' ? 'No se pudo guardar' : saving ? 'Guardando...' : status === 'saved' ? 'Guardado automáticamente' : `${content.length.toLocaleString()} / 100,000 caracteres`}
              </span>
            </div>}
          </div>
        </div>
      )}
    </>
  );
};
