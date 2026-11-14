import React, { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../services/apiFetch';
import { Icon } from './Icon';

const WIDGET_WIDTH = 390;
const WIDGET_HEIGHT = 520;

export const PersonalNotesWidget: React.FC = () => {
  type MessageUser = { id: number; name: string; email: string };
  type Message = { id: number; subject: string; content: string; read_at: string | null; created_at: string; sender_name: string; recipient_name: string };
  
  const [open, setOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [tab, setTab] = useState<'notes' | 'messages'>('notes');
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<'idle' | 'saved' | 'error'>('idle');
  const [loaded, setLoaded] = useState(false);
  const [dirty, setDirty] = useState(false);
  
  // Messaging state
  const [messageUsers, setMessageUsers] = useState<MessageUser[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [messageLoading, setMessageLoading] = useState(false);
  const [messagesLoaded, setMessagesLoaded] = useState(false);
  const [recipientId, setRecipientId] = useState('');
  const [subject, setSubject] = useState('');
  const [messageContent, setMessageContent] = useState('');
  const [messageStatus, setMessageStatus] = useState<'idle' | 'sent' | 'error'>('idle');
  
  // Rail / floating launcher state
  const [fabHidden, setFabHidden] = useState(false);
  const widgetRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Hide the floating launcher while scrolling down on screens without the rail
  useEffect(() => {
    let lastY = 0;
    const handleScroll = (event: Event) => {
      const target = event.target;
      const y = target instanceof HTMLElement ? target.scrollTop : window.scrollY;
      if (y > lastY && y > 160) setFabHidden(true);
      else if (y < lastY) setFabHidden(false);
      lastY = y;
    };
    document.addEventListener('scroll', handleScroll, true);
    return () => document.removeEventListener('scroll', handleScroll, true);
  }, []);

  // Fetch notes on open
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
    if (open && !isMinimized) {
      window.setTimeout(() => textareaRef.current?.focus(), 50);
    }
  }, [open, isMinimized]);

  // Auto-save debounce
  useEffect(() => {
    if (!open || !loaded || !dirty) return;
    const timer = window.setTimeout(() => {
      void save();
    }, 700);
    return () => window.clearTimeout(timer);
  }, [content, dirty, loaded, open]);

  // Fetch internal messages
  useEffect(() => {
    if (!open || tab !== 'messages' || messageLoading || messagesLoaded) return;
    setMessageLoading(true);
    Promise.all([
      apiFetch('/me/message-users').then((response) => response.ok ? response.json() : Promise.reject()),
      apiFetch('/me/messages').then((response) => response.ok ? response.json() : Promise.reject()),
    ])
      .then(([users, inbox]) => {
        setMessageUsers(users);
        setMessages(inbox);
        setMessagesLoaded(true);
      })
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

  const openPanel = () => {
    setStatus('idle');
    setLoaded(false);
    setMessagesLoaded(false);
    setIsMinimized(false);
    setOpen(true);
  };

  const closeRef = useRef(close);
  closeRef.current = close;
  const openRef = useRef(open);
  openRef.current = open;

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.altKey && event.shiftKey && event.key.toLowerCase() === 'n') {
        event.preventDefault();
        if (openRef.current) void closeRef.current();
        else openPanel();
        return;
      }
      if (event.key === 'Escape' && openRef.current && !document.querySelector('[role="dialog"][aria-modal="true"]')) {
        void closeRef.current();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const sendMessage = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!recipientId || !messageContent.trim()) return;
    setMessageStatus('idle');
    try {
      const response = await apiFetch('/me/messages', {
        method: 'POST',
        body: JSON.stringify({ recipientId, subject, content: messageContent }),
      });
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
      {/* Desktop rail: reserves layout space so notes never cover table controls */}
      <aside
        aria-label="Accesos personales"
        className="hidden xl:flex w-[52px] shrink-0 flex-col items-center gap-3 border-l border-[var(--border-subtle)] bg-[var(--bg-surface)] pt-6 pb-4 z-10"
      >
        <button
          type="button"
          onClick={() => (open ? void close() : openPanel())}
          aria-expanded={open}
          title="Bloc de notas (Alt+Shift+N)"
          aria-label="Abrir bloc de notas personal"
          className={`flex h-11 w-11 items-center justify-center rounded-xl border transition-all cursor-pointer active:scale-95 ${
            open
              ? 'border-cyan-400 bg-cyan-500/15 text-cyan-300'
              : 'border-transparent text-[var(--text-secondary)] hover:border-cyan-500/40 hover:bg-cyan-500/10 hover:text-cyan-300'
          }`}
        >
          <Icon name="edit_note" size={21} />
        </button>
        <span className="select-none text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--text-secondary)] [writing-mode:vertical-rl]">
          Notas
        </span>
      </aside>

      {/* Floating launcher for smaller desktops; hides while scrolling down */}
      {!open && (
        <button
          type="button"
          onClick={openPanel}
          title="Bloc de notas (Alt+Shift+N)"
          aria-label="Abrir bloc de notas personal"
          className={`fixed bottom-5 right-5 z-[80] hidden md:flex xl:hidden h-11 items-center gap-2 rounded-full border border-cyan-500/40 bg-[#070c18]/90 backdrop-blur-xl px-4 text-cyan-300 shadow-[0_8px_30px_rgba(0,0,0,0.7)] transition-all duration-200 hover:border-cyan-400 hover:bg-[#09152b] hover:text-white hover:shadow-[0_0_20px_rgba(6,182,212,0.35)] active:scale-95 cursor-pointer font-mono select-none ${
            fabHidden ? 'translate-y-24 opacity-0 pointer-events-none' : ''
          }`}
        >
          <Icon name="edit_note" size={19} className="text-cyan-400" />
          <span className="hidden sm:inline text-xs font-bold">Bloc de notas</span>
        </button>
      )}

      {/* Floating panel anchored to the rail */}
      {open && (
        <div
          ref={widgetRef}
          role="dialog"
          aria-label="Bloc de notas personal"
          style={{
            width: `min(${WIDGET_WIDTH}px, calc(100vw - 24px))`,
            height: isMinimized ? 'auto' : `min(${WIDGET_HEIGHT}px, calc(100vh - 120px))`,
          }}
          className="horizon-notes-panel fixed right-3 bottom-3 z-[85] flex flex-col overflow-hidden rounded-3xl border border-cyan-500/35 shadow-[0_20px_60px_rgba(0,0,0,0.55)] bg-[#070c18]/96 backdrop-blur-2xl select-none xl:right-[68px] xl:bottom-auto xl:top-[92px]"
        >
          {/* Top Laser Line */}
          <div className="cyber-laser-bar absolute top-0 left-0 right-0 z-20" />

          {/* Header Bar */}
          <div className="flex items-center justify-between border-b border-cyan-500/20 bg-[#0a1022]/90 backdrop-blur-md px-3.5 py-2.5 shrink-0">
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-7 h-7 rounded-lg bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400 shrink-0">
                <Icon name="edit_note" size={17} />
              </div>
              <div className="truncate">
                <h2 className="text-xs font-bold text-white font-mono uppercase tracking-wider truncate">
                  Bloc de notas
                </h2>
                {!isMinimized && (
                  <p className="text-[10px] text-slate-400 truncate">Alt+Shift+N para abrir o cerrar</p>
                )}
              </div>
            </div>

            {/* Window Action Controls */}
            <div className="flex items-center gap-1 shrink-0 ml-2">
              {/* Minimize / Expand Toggle Button */}
              <button
                type="button"
                onClick={() => setIsMinimized(!isMinimized)}
                title={isMinimized ? 'Expandir bloc de notas' : 'Minimizar bloc de notas'}
                aria-label={isMinimized ? 'Expandir' : 'Minimizar'}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-cyan-500/15 hover:text-cyan-300 transition-colors cursor-pointer flex items-center justify-center"
              >
                <Icon name={isMinimized ? 'expand_more' : 'expand_less'} size={18} />
              </button>

              {/* Close Button */}
              <button
                type="button"
                onClick={() => void close()}
                aria-label="Cerrar bloc de notas"
                title="Cerrar"
                className="rounded-lg p-1.5 text-slate-400 hover:bg-[var(--state-urgency-tint)] hover:text-[var(--state-urgency-text)] transition-colors cursor-pointer flex items-center justify-center"
              >
                <Icon name="close" size={18} />
              </button>
            </div>
          </div>

          {/* Window Body (Hidden if minimized) */}
          {!isMinimized && (
            <>
              {/* Tabs Navigation */}
              <div className="flex border-b border-cyan-500/20 px-3 pt-2 bg-[#040814]/70 shrink-0">
                <button
                  type="button"
                  onClick={() => setTab('notes')}
                  className={`border-b-2 px-3.5 py-1.5 text-xs font-mono font-bold transition-all cursor-pointer ${
                    tab === 'notes'
                      ? 'border-cyan-400 text-cyan-300'
                      : 'border-transparent text-slate-400 hover:text-white'
                  }`}
                >
                  Mis notas
                </button>
                <button
                  type="button"
                  onClick={() => setTab('messages')}
                  className={`border-b-2 px-3.5 py-1.5 text-xs font-mono font-bold transition-all cursor-pointer ${
                    tab === 'messages'
                      ? 'border-cyan-400 text-cyan-300'
                      : 'border-transparent text-slate-400 hover:text-white'
                  }`}
                >
                  Mensajes internos
                </button>
              </div>

              {/* Tab: Notes */}
              {tab === 'notes' ? (
                <div className="flex flex-1 flex-col p-3.5 bg-[#050914] min-h-0">
                  <textarea
                    ref={textareaRef}
                    value={content}
                    onChange={(event) => {
                      setContent(event.target.value);
                      setDirty(true);
                      setStatus('idle');
                    }}
                    placeholder={loading ? 'Cargando tus apuntes...' : 'Escribe aquí una nota rápida...'}
                    disabled={loading}
                    className="min-h-0 flex-1 resize-none rounded-2xl border border-cyan-500/20 bg-[#070c18] p-3 text-xs leading-6 text-slate-100 outline-none placeholder:text-slate-500 focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400/40 custom-scrollbar font-mono select-text"
                  />
                </div>
              ) : (
                /* Tab: Internal Messages */
                <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3.5 custom-scrollbar bg-[#050914] select-text">
                  <form onSubmit={sendMessage} className="flex flex-col gap-2 rounded-2xl border border-cyan-500/20 bg-[#070c18] p-3 shrink-0">
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
                    {messageStatus === 'sent' && (
                      <span className="text-[11px] text-emerald-400 font-mono">✔ Mensaje enviado</span>
                    )}
                    {messageStatus === 'error' && (
                      <span className="text-[11px] text-red-400 font-mono">✖ Error al enviar el mensaje</span>
                    )}
                  </form>

                  <div className="flex flex-col gap-2">
                    {messageLoading && (
                      <p className="text-xs text-slate-400 font-mono">Cargando mensajes...</p>
                    )}
                    {!messageLoading && messages.length === 0 && (
                      <p className="text-xs text-slate-500 font-mono text-center py-4">Aún no tienes mensajes.</p>
                    )}
                    {messages.map((message) => (
                      <article
                        key={message.id}
                        className={`rounded-2xl border p-3 text-xs transition-all ${
                          message.read_at
                            ? 'border-cyan-500/15 bg-[#070c18]'
                            : 'border-cyan-500/40 bg-cyan-950/20 shadow-[0_0_12px_rgba(6,182,212,0.15)]'
                        }`}
                      >
                        <div className="flex justify-between gap-2">
                          <strong className="text-white font-bold">{message.subject || 'Mensaje interno'}</strong>
                          <time className="text-[10px] text-slate-400 font-mono">
                            {new Date(message.created_at).toLocaleString('es-MX', {
                              dateStyle: 'short',
                              timeStyle: 'short',
                            })}
                          </time>
                        </div>
                        <p className="mt-1 text-[11px] text-cyan-400 font-mono">
                          De {message.sender_name} · Para {message.recipient_name}
                        </p>
                        <p className="mt-2 whitespace-pre-wrap text-slate-300 leading-relaxed">
                          {message.content}
                        </p>
                      </article>
                    ))}
                  </div>
                </div>
              )}

              {/* Status Footer */}
              {tab === 'notes' && (
                <div className="flex items-center justify-between border-t border-cyan-500/15 px-4 py-2 bg-[#070c18] shrink-0">
                  <span
                    className={`text-[11px] font-mono ${
                      status === 'error'
                        ? 'text-red-400'
                        : status === 'saved'
                        ? 'text-emerald-400'
                        : 'text-slate-400'
                    }`}
                  >
                    {status === 'error'
                      ? '✖ Error al guardar'
                      : saving
                      ? '⏳ Guardando...'
                      : status === 'saved'
                      ? '✔ Guardado automáticamente'
                      : `${content.length.toLocaleString()} / 100,000 caracteres`}
                  </span>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </>
  );
};
