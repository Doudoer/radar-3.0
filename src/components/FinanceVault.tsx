import React, { useEffect, useState } from 'react';
import { apiFetch } from '../services/apiFetch';

type Method = 'whatsapp' | 'totp' | 'backup';

export function FinanceVault({ children, onBack }: { children: React.ReactNode; onBack?: () => void }) {
  const [expiresAt, setExpiresAt] = useState(0);
  const [method, setMethod] = useState<Method>('whatsapp');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    let active = true;
    apiFetch('/auth/2fa/vault').then(async response => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'No se pudo verificar la bóveda');
      if (active) setExpiresAt(data.unlocked ? data.expiresAt : 0);
    }).catch(reason => { if (active) setError(reason instanceof Error ? reason.message : 'No se pudo verificar la bóveda'); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!expiresAt) return;
    const timer = setTimeout(() => { setExpiresAt(0); setCode(''); }, Math.max(0, expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [expiresAt]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown(value => Math.max(0, value - 1)), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const request = async (path: string, body: object) => {
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await apiFetch(path, { method: 'POST', body: JSON.stringify(body) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'No se pudo completar la verificación');
      return data;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo completar la verificación');
      return null;
    } finally { setBusy(false); }
  };

  const lock = async () => {
    const result = await request('/auth/2fa/lock', {});
    setExpiresAt(0); setCode('');
    if (!result) setError('No se pudo confirmar el bloqueo en el servidor. Vuelve a intentarlo.');
  };

  if (expiresAt > Date.now()) return <>
    <div className="flex justify-end mb-3 print:hidden">
      <button type="button" disabled={busy} onClick={() => void lock()} className="rounded-xl border border-cyan-500/40 px-4 py-2 text-sm text-cyan-400 cursor-pointer">
        Bloquear bóveda
      </button>
    </div>
    {children}
  </>;

  const digits = method === 'backup' ? 8 : 6;
  return <div className="flex justify-center items-center min-h-[70vh] p-4">
    <section aria-label="Bóveda financiera" className="horizon-vault w-full max-w-lg rounded-3xl border border-cyan-400/40 bg-white dark:bg-slate-950 p-6 md:p-8 shadow-2xl space-y-5 text-center">
      <span className="material-symbols-outlined text-5xl text-cyan-500">shield_lock</span>
      <p className="text-xs tracking-widest font-bold text-cyan-500">AUTENTICACIÓN EN DOS PASOS (2FA)</p>
      <h1 className="text-2xl font-black text-slate-900 dark:text-white">Relación Semanal &amp; Finanzas</h1>
      <p className="text-sm text-slate-500">Bóveda financiera protegida de Radar 3.0. Ingresa el código de seguridad para desbloquear el acceso.</p>
      <div className="flex gap-2 rounded-xl border border-cyan-500/30 p-1">
        {([['whatsapp', 'WhatsApp'], ['totp', 'Authenticator'], ['backup', '8 Códigos']] as const).map(([value, label]) =>
          <button key={value} type="button" aria-pressed={method === value} disabled={busy} onClick={() => { setMethod(value); setCode(''); setError(''); setNotice(''); }}
            className={`flex-1 rounded-lg px-2 py-2 text-xs font-bold cursor-pointer ${method === value ? 'bg-cyan-500/20 text-cyan-600' : 'text-slate-500'}`}>{label}</button>)}
      </div>
      {method === 'whatsapp' ? <div className="rounded-2xl border border-cyan-500/30 p-4 space-y-3">
        <p className="text-xs font-bold text-emerald-500">CANAL SEGURO WHATSAPP</p>
        <p className="text-sm text-slate-500">El PIN se envía al administrador y expira en 1 minuto.</p>
        <button type="button" disabled={busy || cooldown > 0} onClick={async () => {
          const result = await request('/auth/2fa/request-otp', {});
          if (result?.dispatched) {
            setCooldown(result.cooldownSeconds || 60);
            if (result.devCode) {
              setCode(result.devCode);
              setNotice(`[Modo Local] PIN generado: ${result.devCode} (auto-completado)`);
            } else {
              setNotice(result.message);
            }
          }
        }} className="rounded-xl bg-cyan-500 px-4 py-2 font-bold text-slate-950 disabled:opacity-50 cursor-pointer">
          {cooldown > 0 ? `Solicitar en ${cooldown}s` : 'Solicitar Código'}
        </button>
      </div> : <p className="text-sm text-slate-500">{method === 'totp' ? 'Usa el código de tu aplicación Authenticator ya configurada.' : 'Ingresa uno de tus códigos de respaldo de un solo uso.'}</p>}
      <form className="space-y-4" onSubmit={async event => {
        event.preventDefault();
        const result = await request('/auth/2fa/verify-otp', { code, method });
        if (result?.verified && Number.isFinite(result.expiresAt) && result.expiresAt > Date.now()) {
          setCode(''); setExpiresAt(result.expiresAt);
        }
      }}>
        <label className="block text-xs font-bold text-cyan-500" htmlFor="finance-pin">PIN DE SEGURIDAD ({digits} DÍGITOS)</label>
        <div className="relative flex justify-center gap-2 rounded-xl focus-within:ring-2 focus-within:ring-cyan-500">
          <input id="finance-pin" aria-label="PIN de seguridad" type="text" inputMode="numeric" autoComplete="one-time-code" pattern={`[0-9]{${digits}}`} maxLength={digits}
            value={code} onChange={event => setCode(event.target.value.replace(/\D/g, ''))} disabled={busy}
            className="absolute inset-0 w-full h-full opacity-0 cursor-text" />
          {Array.from({ length: digits }, (_, index) => <span key={index} aria-hidden="true"
            className="flex-1 max-w-12 h-14 rounded-2xl border border-slate-300 dark:border-slate-700 flex items-center justify-center text-2xl text-cyan-500">{code[index] ? '•' : ''}</span>)}
        </div>
        {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
        {notice && <p role="status" className="text-sm text-emerald-500">{notice}</p>}
        <button type="submit" disabled={busy || code.length !== digits} className="w-full rounded-xl bg-cyan-500 py-3 font-bold text-slate-950 disabled:opacity-40 cursor-pointer">
          {busy ? 'Verificando…' : 'VERIFICAR Y DESBLOQUEAR'}
        </button>
      </form>
      {onBack && <button type="button" onClick={onBack} className="text-sm text-cyan-500 cursor-pointer">← Volver al Dashboard Principal</button>}
    </section>
  </div>;
}
