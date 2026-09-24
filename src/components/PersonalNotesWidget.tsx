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
        className="fixed bottom-5 right-5 z-[80] flex h-11 items-center gap-2 rounded-full border border-cyan-500/40 bg-[#070c18]/90 backdrop-blur-xl px-4 text-cyan-300 shadow-[0_8px_30px_rgba(0,0,0,0.7)] transition-all hover:border-cyan-400 hover:bg-[#09152b] hover:text-white hover:shadow-[0_0_20px_rgba(6,182,212,0.35)] active:scale-95 cursor-pointer font-mono"
      >
        <span className="material-symbols-outlined text-[19px] text-cyan-400">edit_note</span>
        <span className="text-xs font-bold">Bloc de notas</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-[80] pointer-events-none">
          <div className="pointer-events-auto absolute bottom-5 right-5 flex h-[min(620px,calc(100vh-2.5rem))] w-[min(430px,calc(100vw-2rem))] flex-col overflow-hidden rounded-3xl border border-cyan-500/30 bg-[#070c18]/95 backdrop-blur-2xl shadow-[0_20px_60px_rgba(0,0,0,0.85)] relative">
            <div className="cyber-laser-bar absolute top-0 left-0 right-0 z-20" />
            
            <div className="flex items-start justify-between border-b border-cyan-500/20 bg-[#0a1022]/80 backdrop-blur-md px-4 py-3">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
                  <span className="material-symbols-outlined text-[19px]">edit_note</span>
                </div>
                <div>
                  <h2 className="text-sm font-bold text-white font-mono uppercase tracking-wider">Bloc de notas personal</h2>
                  <p className="text-[11px] text-slate-400">Tus apuntes privados persistentes.</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => void close()}
                aria-label="Cerrar bloc de notas"
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white transition-colors cursor-pointer"
              >
                <span className="material-symbols-outlined text-[19px]">close</span>
              </button>
            </div>

            <div className="flex border-b border-cyan-500/20 px-3 pt-2 bg-[#040814]/60">
              <button
                type="button"
                onClick={() => setTab('notes')}
                className={`border-b-2 px-3.5 py-2 text-xs font-mono font-bold transition-all cursor-pointer ${
                  tab === 'notes' ? 'border-cyan-400 text-cyan-300' : 'border-transparent text-slate-400 hover:text-white'
                }`}
              >
                Mis notas
              </button>
              <button
                type="button"
                onClick={() => setTab('messages')}
                className={`border-b-2 px-3.5 py-2 text-xs font-mono font-bold transition-all cursor-pointer ${
                  tab === 'messages' ? 'border-cyan-400 text-cyan-300' : 'border-transparent text-slate-400 hover:text-white'
                }`}
              >
                Mensajes internos
              </button>
            </div>

            {tab === 'notes' ? (
              <div className="flex flex-1 flex-col p-3.5 bg-[#050914]">
                <textarea
                  ref={textareaRef}
                  value={content}
                  onChange={(event) => { setContent(event.target.value); setDirty(true); setStatus('idle'); }}
                  placeholder={loading ? 'Cargando tus apuntes...' : 'Escribe aquí una nota rápida...'}
                  disabled={loading}
                  className="min-h-0 flex-1 resize-none rounded-2xl border border-cyan-500/20 bg-[#070c18] p-3 text-xs leading-6 text-slate-100 outline-none placeholder:text-slate-500 focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400/40 custom-scrollbar font-mono"
                />
              </div>
            ) : (
              <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3.5 custom-scrollbar bg-[#050914]">
                <form onSubmit={sendMessage} className="flex flex-col gap-2 rounded-2xl border border-cyan-500/20 bg-[#070c18] p-3">
                  <select
                    value={recipientId}
                    onChange={(event) => setRecipientId(event.target.value)}
                    className="cyber-input text-xs"
                    required
                  >
                    <option value="">Seleccionar destinatario...</option>
                    {messageUsers.map((user) => (
                      <option key={user.id} value={user.id} className="bg-[#070c18] text-white">
                        {user.name} · {user.email}
                      </option>
                    ))}
                  </select>
                  <input
                    value={subject}
                    onChange={(event) => setSubject(event.target.value)}
                    placeholder="Asunto (opcional)"
                    className="cyber-input text-xs"
                  />
                  <textarea
                    value={messageContent}
                    onChange={(event) => setMessageContent(event.target.value)}
                    placeholder="Escribe un mensaje rápido..."
                    rows={3}
                    className="cyber-input text-xs resize-none"
                    required
                  />
                  <button
                    type="submit"
                    className="cyber-btn-primary self-end py-1.5 px-3.5 text-xs font-black cursor-pointer"
                  >
                    Enviar mensaje
                  </button>
                  {messageStatus === 'sent' && <span className="text-[11px] text-emerald-400 font-mono">✔ Mensaje enviado</span>}
                  {messageStatus === 'error' && <span className="text-[11px] text-red-400 font-mono">✖ Error al enviar el mensaje</span>}
                </form>

                <div className="flex flex-col gap-2">
                  {messageLoading && <p className="text-xs text-slate-400 font-mono">Cargando mensajes...</p>}
                  {!messageLoading && messages.length === 0 && <p className="text-xs text-slate-500 font-mono text-center py-4">Aún no tienes mensajes.</p>}
                  {messages.map((message) => (
                    <article
                      key={message.id}
                      className={`rounded-2xl border p-3 text-xs transition-all ${
                        message.read_at ? 'border-cyan-500/15 bg-[#070c18]' : 'border-cyan-500/40 bg-cyan-950/20 shadow-[0_0_12px_rgba(6,182,212,0.15)]'
                      }`}
                    >
                      <div className="flex justify-between gap-2">
                        <strong className="text-white font-bold">{message.subject || 'Mensaje interno'}</strong>
                        <time className="text-[10px] text-slate-400 font-mono">
                          {new Date(message.created_at).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' })}
                        </time>
                      </div>
                      <p className="mt-1 text-[11px] text-cyan-400 font-mono">De {message.sender_name} · Para {message.recipient_name}</p>
                      <p className="mt-2 whitespace-pre-wrap text-slate-300 leading-relaxed">{message.content}</p>
                    </article>
                  ))}
                </div>
              </div>
            )}

            {tab === 'notes' && (
              <div className="flex items-center justify-between border-t border-cyan-500/15 px-4 py-2.5 bg-[#070c18]">
                <span className={`text-[11px] font-mono ${status === 'error' ? 'text-red-400' : status === 'saved' ? 'text-emerald-400' : 'text-slate-400'}`}>
                  {status === 'error' ? '✖ Error al guardar' : saving ? '⏳ Guardando...' : status === 'saved' ? '✔ Guardado automáticamente' : `${content.length.toLocaleString()} / 100,000 caracteres`}
                </span>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
};
