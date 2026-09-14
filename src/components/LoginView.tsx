import React, { FormEvent, useState } from 'react';
import { apiFetch } from '../services/apiFetch';

interface LoginViewProps {
  onAuthenticated: (token: string, user: { role: string }) => void;
}

export const LoginView: React.FC<LoginViewProps> = ({ onAuthenticated }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const response = await apiFetch('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message || 'No se pudo iniciar sesión.');
      localStorage.setItem('radar_token', payload.token);
      onAuthenticated(payload.token, payload.user);
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : 'No se pudo iniciar sesión.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#080d19] px-4 text-[#dfe2ef]">
      <form onSubmit={handleSubmit} className="w-full max-w-md rounded-2xl border border-[#1e293b] bg-[#0f172a] p-8 shadow-2xl">
        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.3em] text-[#58a6ff]">Radar 3.0</p>
        <h1 className="mb-2 text-2xl font-bold">Iniciar sesión</h1>
        <p className="mb-6 text-sm text-slate-400">Accede con un usuario autorizado.</p>
        <label className="mb-4 block text-sm text-slate-300">
          Correo electrónico
          <input className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 outline-none focus:border-blue-400" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoComplete="email" />
        </label>
        <label className="mb-4 block text-sm text-slate-300">
          Contraseña
          <input className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 outline-none focus:border-blue-400" type="password" value={password} onChange={(event) => setPassword(event.target.value)} required autoComplete="current-password" />
        </label>
        {error && <p className="mb-4 rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</p>}
        <button className="w-full rounded-lg bg-blue-500 px-4 py-2 font-semibold text-white transition hover:bg-blue-400 disabled:cursor-not-allowed disabled:opacity-60" type="submit" disabled={submitting}>
          {submitting ? 'Validando...' : 'Entrar'}
        </button>
      </form>
    </main>
  );
};
