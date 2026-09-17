import React, { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../services/apiFetch';

export const PersonalNotesWidget: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<'idle' | 'saved' | 'error'>('idle');
  const [loaded, setLoaded] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!open || loaded || loading) return;
    setLoaded(true);
    setLoading(true);
    apiFetch('/me/notes')
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((payload) => setContent(payload.content || ''))
      .catch(() => setStatus('error'))
      .finally(() => setLoading(false));
  }, [open, loaded, loading]);

  useEffect(() => {
    if (open) window.setTimeout(() => textareaRef.current?.focus(), 0);
  }, [open]);

  const save = async () => {
    setSaving(true);
    setStatus('idle');
    try {
      const response = await apiFetch('/me/notes', {
        method: 'PUT',
        body: JSON.stringify({ content }),
      });
      if (!response.ok) throw new Error('No se pudo guardar el bloc de notas.');
      setStatus('saved');
    } catch {
      setStatus('error');
    } finally {
      setSaving(false);
    }
  };

  const close = async () => {
    if (content.trim()) await save();
    setOpen(false);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => { setStatus('idle'); setOpen(true); }}
        title="Abrir bloc de notas personal"
        aria-label="Abrir bloc de notas personal"
        className="fixed bottom-5 right-5 z-40 flex h-12 w-12 items-center justify-center rounded-full border border-[#3b82f6]/50 bg-[#13233c] text-[#8dbbff] shadow-[0_8px_28px_rgba(0,0,0,0.35)] transition hover:border-[#58a6ff] hover:bg-[#1d3559] hover:text-white"
      >
        <span className="material-symbols-outlined">edit_note</span>
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
            <div className="flex flex-1 flex-col p-3">
              <textarea
                ref={textareaRef}
                value={content}
                onChange={(event) => { setContent(event.target.value); setStatus('idle'); }}
                placeholder={loading ? 'Cargando tus apuntes...' : 'Escribe aquí una nota rápida...'}
                disabled={loading}
                className="min-h-0 flex-1 resize-none rounded-xl border border-[#263653] bg-[#080d19] p-3 text-sm leading-6 text-[#e2e8f0] outline-none placeholder:text-[#64748b] focus:border-[#58a6ff]"
              />
            </div>
            <div className="flex items-center justify-between border-t border-[#1e293b] px-4 py-3">
              <span className={`text-[11px] ${status === 'error' ? 'text-[#fca5a5]' : status === 'saved' ? 'text-[#6ee7b7]' : 'text-[#64748b]'}`}>
                {status === 'error' ? 'No se pudo guardar' : status === 'saved' ? 'Guardado' : `${content.length.toLocaleString()} / 100,000 caracteres`}
              </span>
              <button type="button" onClick={() => void save()} disabled={saving || loading} className="rounded-lg bg-[#388bfd] px-3 py-2 text-xs font-bold text-[#07111f] transition hover:bg-[#58a6ff] disabled:cursor-not-allowed disabled:opacity-50">{saving ? 'Guardando...' : 'Guardar'}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
