import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { apiFetch } from '../services/apiFetch';
import { PRESET_AVATARS, DEFAULT_AVATAR } from './UserProfileModal';
import { VaultUnlockModal } from './VaultUnlockModal';
import { useFeedback } from './FeedbackProvider';

export type ManagedUser = {
  id: number;
  name: string;
  email: string;
  phone?: string;
  avatar_url?: string;
  role: string;
  permissions: string[];
  active: number;
  updated_at: string;
};

export type YardCashReceiver = {
  id: number;
  name: string;
  roleLabel: string;
  active: boolean;
  createdAt?: string;
  updatedAt?: string;
};

const permissionOptions = [
  ['orders:view', 'Consultar órdenes'],
  ['orders:edit', 'Editar órdenes'],
  ['customers:view', 'Consultar clientes'],
  ['customers:edit', 'Editar clientes'],
  ['claims:view', 'Consultar reclamos'],
  ['claims:manage', 'Gestionar reclamos'],
  ['reports:view', 'Consultar reportes'],
  ['users:manage', 'Gestionar usuarios'],
  ['settings:manage', 'Gestionar configuración'],
] as const;

// ============================================================================
// ULTRA-FAST RESILIENT AVATAR COMPONENT (Zero network hang, instant fallback)
// ============================================================================
export const UserAvatar: React.FC<{
  url?: string | null;
  name: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}> = React.memo(({ url, name, size = 'md', className = '' }) => {
  const [hasError, setHasError] = useState(false);

  const sizeClasses =
    size === 'sm'
      ? 'w-7 h-7 text-xs rounded-lg'
      : size === 'lg'
      ? 'w-12 h-12 text-sm rounded-xl'
      : 'w-10 h-10 text-xs rounded-2xl';

  const initials = useMemo(() => {
    return (name || '?')
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() || '')
      .join('') || '?';
  }, [name]);

  if (url && !hasError) {
    return (
      <div className={`${sizeClasses} overflow-hidden bg-[#040814] border border-cyan-500/40 shadow-sm shrink-0 ${className}`}>
        <img
          src={url}
          alt={name}
          loading="lazy"
          decoding="async"
          className="w-full h-full object-cover"
          onError={() => setHasError(true)}
        />
      </div>
    );
  }

  // Deterministic vibrant cyber gradient based on user's name
  const gradients = [
    'from-cyan-600 to-blue-700 border-cyan-400/40',
    'from-purple-600 to-indigo-700 border-purple-400/40',
    'from-emerald-600 to-teal-700 border-emerald-400/40',
    'from-amber-600 to-orange-700 border-amber-400/40',
    'from-blue-600 to-cyan-700 border-blue-400/40',
    'from-rose-600 to-pink-700 border-rose-400/40',
  ];
  const charCode = name ? name.charCodeAt(0) : 0;
  const gradient = gradients[charCode % gradients.length];

  return (
    <div
      className={`${sizeClasses} bg-gradient-to-br ${gradient} text-white font-bold flex items-center justify-center border shadow-sm shrink-0 select-none font-mono tracking-tight ${className}`}
      title={name}
    >
      {initials}
    </div>
  );
});

// ============================================================================
// MODAL: EDIT USER & PERMISSIONS (Isolated State -> 60fps typing)
// ============================================================================
interface UserEditModalProps {
  user: ManagedUser;
  mode: 'edit' | 'permissions';
  onClose: () => void;
  onSuccess: (updatedUser: ManagedUser) => void;
  onUnlockVaultNeeded: (retryAction: () => void) => void;
  isVaultLocked: boolean;
}

const UserEditModal: React.FC<UserEditModalProps> = React.memo(({
  user,
  mode,
  onClose,
  onSuccess,
  onUnlockVaultNeeded,
  isVaultLocked,
}) => {
  const [draft, setDraft] = useState({
    name: user.name,
    email: user.email,
    phone: user.phone || '',
    avatar_url: user.avatar_url || '',
    password: '',
    role: user.role,
    active: Boolean(user.active),
    permissions: user.permissions || [],
  });

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type)) {
      setError('Usa una imagen PNG, JPEG, WebP o GIF.');
      return;
    }
    if (file.size > 350 * 1024) {
      setError('La imagen de perfil no debe superar los 350KB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setDraft((prev) => ({ ...prev, avatar_url: reader.result as string }));
        setError(null);
      }
    };
    reader.readAsDataURL(file);
  };

  const togglePermission = (permission: string) => {
    setDraft((prev) => ({
      ...prev,
      permissions: prev.permissions.includes(permission)
        ? prev.permissions.filter((p) => p !== permission)
        : [...prev.permissions, permission],
    }));
  };

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const payload: Record<string, any> = {
        name: draft.name.trim(),
        email: draft.email.trim().toLowerCase(),
        phone: draft.phone.trim() || null,
        avatar_url: draft.avatar_url.trim() || null,
        role: draft.role,
        active: draft.active,
        permissions: draft.permissions,
      };

      if (draft.password.trim()) {
        payload.password = draft.password.trim();
      }

      const response = await apiFetch(`/users/${user.id}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (
          data.code === 'FINANCE_LOCKED' ||
          (response.status === 403 &&
            (data.message?.toLowerCase().includes('boveda') || data.message?.toLowerCase().includes('bóveda')))
        ) {
          onUnlockVaultNeeded(() => { void handleSave(event); });
          return;
        }
        throw new Error(data.message || 'No se pudo actualizar el usuario.');
      }
      onSuccess(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo actualizar el usuario.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="horizon-modal fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-3 sm:p-4 backdrop-blur-sm animate-fade-in">
      <form
        onSubmit={handleSave}
        className="relative w-full max-w-lg max-h-[min(94vh,720px)] flex flex-col rounded-3xl border border-cyan-500/30 bg-[#070c18] p-5 sm:p-6 shadow-[0_20px_50px_rgba(0,0,0,0.8)] overflow-hidden"
      >
        <div className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-transparent via-cyan-400 to-indigo-500 shadow-[0_0_12px_#22d3ee]" />

        <div className="mb-4 flex items-start justify-between gap-4 shrink-0">
          <div>
            <p className="text-[10px] font-bold uppercase font-mono tracking-[0.18em] text-cyan-400">
              {mode === 'edit' ? 'Editar cuenta de usuario' : 'Editar permisos de acceso'}
            </p>
            <h2 className="mt-1 text-lg font-bold text-white">{user.name}</h2>
            <p className="mt-1 text-xs text-slate-400">Modifica datos de perfil, teléfono, avatar y credenciales.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="p-1 rounded-xl text-slate-400 hover:text-white hover:bg-cyan-500/20 transition-all cursor-pointer"
            aria-label="Cerrar"
          >
            <span aria-hidden="true" className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar pr-1 space-y-3.5">
          {mode === 'edit' && (
            <>
              {/* Avatar Picker */}
              <div className="p-3 bg-[#040814] border border-cyan-500/25 rounded-2xl space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-mono uppercase text-slate-300 font-bold">Avatar de Perfil</span>
                  <label className="text-[10.5px] font-mono text-cyan-400 hover:text-cyan-200 cursor-pointer flex items-center gap-1">
                    <span aria-hidden="true" className="material-symbols-outlined text-[13px]">upload</span>
                    <span>Subir</span>
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/gif"
                      onChange={handleFileUpload}
                      className="hidden"
                    />
                  </label>
                </div>
                <div className="flex items-center gap-3">
                  <UserAvatar url={draft.avatar_url} name={draft.name || user.name} size="lg" />
                  <div className="flex-1 flex flex-wrap gap-1.5">
                    {PRESET_AVATARS.slice(0, 6).map((av) => (
                      <button
                        key={av.id}
                        type="button"
                        onClick={() => setDraft((prev) => ({ ...prev, avatar_url: av.url }))}
                        className={`w-7 h-7 rounded-lg overflow-hidden border transition-all cursor-pointer ${
                          draft.avatar_url === av.url
                            ? 'border-cyan-400 scale-105 ring-1 ring-cyan-400'
                            : 'border-slate-700 opacity-60 hover:opacity-100'
                        }`}
                      >
                        <img
                          src={av.url}
                          alt={av.label}
                          loading="lazy"
                          decoding="async"
                          className="w-full h-full object-cover"
                        />
                      </button>
                    ))}
                    {draft.avatar_url && (
                      <button
                        type="button"
                        onClick={() => setDraft((prev) => ({ ...prev, avatar_url: '' }))}
                        className="px-2 py-0.5 rounded-lg border border-slate-700 text-[10px] text-slate-400 hover:text-white"
                        title="Usar iniciales automáticas"
                      >
                        Iniciales
                      </button>
                    )}
                  </div>
                </div>
              </div>

              <label className="text-xs text-slate-300 font-mono uppercase text-[10px] block">
                Nombre Completo
                <input
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  className="mt-1 w-full rounded-xl border border-cyan-500/30 bg-[#040814] px-3.5 py-2 text-sm text-white outline-none focus:border-cyan-400"
                  required
                />
              </label>

              <label className="text-xs text-slate-300 font-mono uppercase text-[10px] block">
                Correo Electrónico
                <input
                  type="email"
                  value={draft.email}
                  onChange={(e) => setDraft({ ...draft, email: e.target.value })}
                  className="mt-1 w-full rounded-xl border border-cyan-500/30 bg-[#040814] px-3.5 py-2 text-sm text-white outline-none focus:border-cyan-400 font-mono"
                  required
                />
              </label>

              <label className="text-xs text-slate-300 font-mono uppercase text-[10px] block">
                Teléfono / WhatsApp
                <input
                  type="tel"
                  value={draft.phone}
                  onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
                  placeholder="Ej. +1 (919) 555-0199"
                  className="mt-1 w-full rounded-xl border border-cyan-500/30 bg-[#040814] px-3.5 py-2 text-sm text-white outline-none focus:border-cyan-400 font-mono"
                />
              </label>

              <label className="text-xs text-slate-300 font-mono uppercase text-[10px] block">
                Restablecer Contraseña (opcional)
                <input
                  type="password"
                  value={draft.password}
                  onChange={(e) => setDraft({ ...draft, password: e.target.value })}
                  placeholder="Dejar en blanco para mantener la actual"
                  className="mt-1 w-full rounded-xl border border-cyan-500/30 bg-[#040814] px-3.5 py-2 text-sm text-white outline-none focus:border-cyan-400 font-mono"
                />
              </label>

              <label className="text-xs text-slate-300 font-mono uppercase text-[10px] block">
                Rol
                <select
                  value={draft.role}
                  onChange={(e) => setDraft({ ...draft, role: e.target.value })}
                  className="mt-1 w-full rounded-xl border border-cyan-500/30 bg-[#040814] px-3.5 py-2 text-sm text-white outline-none focus:border-cyan-400"
                >
                  <option value="operator">Operador / Vendedor Oficina</option>
                  <option value="vendedor_yarda">🚜 Vendedor Yarda (Patio)</option>
                  <option value="admin">Administrador</option>
                </select>
              </label>

              <label className="flex items-center gap-2.5 text-xs text-slate-300 pt-1 cursor-pointer">
                <input
                  type="checkbox"
                  checked={draft.active}
                  onChange={(e) => setDraft({ ...draft, active: e.target.checked })}
                  className="h-4 w-4 accent-cyan-400 rounded cursor-pointer"
                />
                <span>Cuenta activa</span>
              </label>
            </>
          )}

          {mode === 'permissions' && (
            <div className="grid gap-2 sm:grid-cols-2">
              {permissionOptions.map(([permission, label]) => (
                <label
                  key={permission}
                  className="flex cursor-pointer items-center gap-2 rounded-xl border border-cyan-500/20 bg-[#040814] px-3 py-2 text-xs text-slate-300 hover:border-cyan-500/50 transition-colors"
                >
                  <input
                    type="checkbox"
                    checked={draft.permissions.includes(permission)}
                    onChange={() => togglePermission(permission)}
                    className="h-4 w-4 accent-cyan-400 rounded"
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>
          )}
        </div>

        {error && (
          <div className="mt-4 rounded-xl border border-red-500/40 bg-red-950/30 p-3 text-xs text-red-300 flex flex-col sm:flex-row items-center justify-between gap-2.5 shrink-0">
            <div className="flex items-center gap-2">
              <span aria-hidden="true" className="material-symbols-outlined text-red-400 text-[18px]">error</span>
              <span>{error}</span>
            </div>
            {(error.toLowerCase().includes('boveda') || error.toLowerCase().includes('bóveda') || isVaultLocked) && (
              <button
                type="button"
                onClick={() => onUnlockVaultNeeded(() => {})}
                className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs font-mono flex items-center gap-1.5 shrink-0 shadow-md cursor-pointer"
              >
                <span aria-hidden="true" className="material-symbols-outlined text-[16px]">key</span>
                <span>Desbloquear Bóveda (2FA)</span>
              </button>
            )}
          </div>
        )}

        <div className="mt-4 pt-3 border-t border-cyan-500/20 flex justify-end gap-2.5 shrink-0">
          <button type="button" onClick={onClose} disabled={saving} className="cyber-btn-secondary px-4 py-2 text-xs font-bold">
            Cancelar
          </button>
          <button
            type="submit"
            disabled={saving}
            className="cyber-btn-primary px-4 py-2 text-xs font-black disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? 'Guardando...' : 'Guardar cambios'}
          </button>
        </div>
      </form>
    </div>
  );
});

// ============================================================================
// MODAL: CREATE USER (Isolated State -> 60fps typing)
// ============================================================================
interface UserCreateModalProps {
  onClose: () => void;
  onSuccess: (newUser: ManagedUser) => void;
  onUnlockVaultNeeded: (retryAction: () => void) => void;
  isVaultLocked: boolean;
}

const UserCreateModal: React.FC<UserCreateModalProps> = React.memo(({
  onClose,
  onSuccess,
  onUnlockVaultNeeded,
  isVaultLocked,
}) => {
  const [draft, setDraft] = useState({
    name: '',
    email: '',
    phone: '',
    avatar_url: '',
    password: '',
    role: 'operator' as 'operator' | 'admin' | 'vendedor_yarda',
    active: true,
    permissions: ['orders:view', 'orders:edit', 'customers:view', 'claims:view'] as string[],
  });

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const passwordRules = useMemo(() => {
    const pw = draft.password;
    return [
      { label: '8+ caracteres', met: pw.length >= 8 },
      { label: 'Mayúscula (A-Z)', met: /[A-Z]/.test(pw) },
      { label: 'Minúscula (a-z)', met: /[a-z]/.test(pw) },
      { label: 'Dígito (0-9)', met: /[0-9]/.test(pw) },
      { label: 'Signo o punto (. ! @ # etc.)', met: /[^a-zA-Z0-9]/.test(pw) },
    ];
  }, [draft.password]);

  const isPasswordValid = useMemo(() => passwordRules.every((r) => r.met), [passwordRules]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type)) {
      setError('Usa una imagen PNG, JPEG, WebP o GIF.');
      return;
    }
    if (file.size > 350 * 1024) {
      setError('La imagen de perfil no debe superar los 350KB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setDraft((prev) => ({ ...prev, avatar_url: reader.result as string }));
        setError(null);
      }
    };
    reader.readAsDataURL(file);
  };

  const togglePermission = (permission: string) => {
    setDraft((prev) => ({
      ...prev,
      permissions: prev.permissions.includes(permission)
        ? prev.permissions.filter((p) => p !== permission)
        : [...prev.permissions, permission],
    }));
  };

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const response = await apiFetch('/users', {
        method: 'POST',
        body: JSON.stringify({
          name: draft.name.trim(),
          email: draft.email.trim().toLowerCase(),
          phone: draft.phone.trim() || null,
          avatar_url: draft.avatar_url.trim() || null,
          password: draft.password,
          role: draft.role,
          active: draft.active,
          permissions: draft.permissions,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (
          payload.code === 'FINANCE_LOCKED' ||
          (response.status === 403 &&
            (payload.message?.toLowerCase().includes('boveda') || payload.message?.toLowerCase().includes('bóveda')))
        ) {
          onUnlockVaultNeeded(() => { void handleCreate(event); });
          return;
        }
        throw new Error(payload.message || 'No se pudo crear el usuario.');
      }
      onSuccess(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo crear el usuario.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="horizon-modal fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-3 sm:p-4 backdrop-blur-sm animate-fade-in">
      <form
        onSubmit={handleCreate}
        className="relative w-full max-w-lg max-h-[min(94vh,740px)] flex flex-col rounded-3xl border border-cyan-500/30 bg-[#070c18] p-5 sm:p-6 shadow-[0_20px_50px_rgba(0,0,0,0.8)] overflow-hidden"
      >
        <div className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-transparent via-cyan-400 to-emerald-400 shadow-[0_0_12px_#22d3ee]" />

        <div className="mb-4 flex items-start justify-between gap-4 shrink-0">
          <div>
            <p className="text-[10px] font-bold uppercase font-mono tracking-[0.18em] text-cyan-400">Nuevo Colaborador</p>
            <h2 className="mt-1 text-lg font-bold text-white">Registrar cuenta de personal</h2>
            <p className="mt-1 text-xs text-slate-400">Crea el acceso con perfil completo, avatar, teléfono y contraseña segura.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="p-1 rounded-xl text-slate-400 hover:text-white hover:bg-cyan-500/20 transition-all cursor-pointer"
            aria-label="Cerrar"
          >
            <span aria-hidden="true" className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        <div className="grid gap-3 flex-1 min-h-0 overflow-y-auto custom-scrollbar pr-1">
          {/* Avatar Selector */}
          <div className="p-3 bg-[#040814] border border-cyan-500/25 rounded-2xl space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-mono uppercase text-slate-300 font-bold">Avatar Inicial</span>
              <label className="text-[10.5px] font-mono text-cyan-400 hover:text-cyan-200 cursor-pointer flex items-center gap-1">
                <span aria-hidden="true" className="material-symbols-outlined text-[13px]">upload</span>
                <span>Subir Foto</span>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  onChange={handleFileUpload}
                  className="hidden"
                />
              </label>
            </div>
            <div className="flex items-center gap-3">
              <UserAvatar url={draft.avatar_url} name={draft.name || 'Nuevo'} size="lg" />
              <div className="flex-1 flex flex-wrap gap-1.5">
                {PRESET_AVATARS.slice(0, 6).map((av) => (
                  <button
                    key={av.id}
                    type="button"
                    onClick={() => setDraft((prev) => ({ ...prev, avatar_url: av.url }))}
                    className={`w-7 h-7 rounded-lg overflow-hidden border transition-all cursor-pointer ${
                      draft.avatar_url === av.url
                        ? 'border-cyan-400 scale-105 ring-1 ring-cyan-400'
                        : 'border-slate-700 opacity-60 hover:opacity-100'
                    }`}
                  >
                    <img
                      src={av.url}
                      alt={av.label}
                      loading="lazy"
                      decoding="async"
                      className="w-full h-full object-cover"
                    />
                  </button>
                ))}
                {draft.avatar_url && (
                  <button
                    type="button"
                    onClick={() => setDraft((prev) => ({ ...prev, avatar_url: '' }))}
                    className="px-2 py-0.5 rounded-lg border border-slate-700 text-[10px] text-slate-400 hover:text-white"
                  >
                    Iniciales
                  </button>
                )}
              </div>
            </div>
          </div>

          <label className="text-xs text-slate-300 font-mono uppercase text-[10px]">
            Nombre Completo *
            <input
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder="Ej. Carlos Mendoza"
              className="mt-1 w-full rounded-xl border border-cyan-500/30 bg-[#040814] px-3.5 py-2 text-sm text-white outline-none focus:border-cyan-400"
              required
            />
          </label>

          <label className="text-xs text-slate-300 font-mono uppercase text-[10px]">
            Correo Electrónico *
            <input
              type="email"
              value={draft.email}
              onChange={(e) => setDraft({ ...draft, email: e.target.value })}
              placeholder="carlos@empresa.com"
              className="mt-1 w-full rounded-xl border border-cyan-500/30 bg-[#040814] px-3.5 py-2 text-sm text-white outline-none focus:border-cyan-400 font-mono"
              required
            />
          </label>

          <label className="text-xs text-slate-300 font-mono uppercase text-[10px]">
            Teléfono / WhatsApp
            <input
              type="tel"
              value={draft.phone}
              onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
              placeholder="+1 (919) 555-0122"
              className="mt-1 w-full rounded-xl border border-cyan-500/30 bg-[#040814] px-3.5 py-2 text-sm text-white outline-none focus:border-cyan-400 font-mono"
            />
          </label>

          <div>
            <label className="text-xs text-slate-300 font-mono uppercase text-[10px]">
              Contraseña de Acceso (mínimo 8 caracteres) *
              <input
                type="password"
                value={draft.password}
                onChange={(e) => setDraft({ ...draft, password: e.target.value })}
                placeholder="••••••••"
                className="mt-1 w-full rounded-xl border border-cyan-500/30 bg-[#040814] px-3.5 py-2 text-sm text-white outline-none focus:border-cyan-400 font-mono"
                required
                minLength={8}
              />
            </label>
            {draft.password.length > 0 && (
              <div className="mt-2.5 p-3 bg-[#040814] border border-cyan-500/20 rounded-2xl space-y-1.5 text-[10px]">
                {passwordRules.map((item, i) => (
                  <div key={i} className={`flex items-center gap-1.5 ${item.met ? 'text-emerald-400' : 'text-slate-500'}`}>
                    <span aria-hidden="true" className="material-symbols-outlined text-[14px]">{item.met ? 'check_circle' : 'radio_button_unchecked'}</span>
                    <span>{item.label}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <label className="text-xs text-slate-300 font-mono uppercase text-[10px]">
            Rol en el Sistema
            <select
              value={draft.role}
              onChange={(e) => setDraft({ ...draft, role: e.target.value as 'operator' | 'admin' | 'vendedor_yarda' })}
              className="mt-1 w-full rounded-xl border border-cyan-500/30 bg-[#040814] px-3.5 py-2 text-sm text-white outline-none focus:border-cyan-400"
            >
              <option value="operator">Operador / Vendedor Oficina</option>
              <option value="vendedor_yarda">🚜 Vendedor Yarda (Patio)</option>
              <option value="admin">Administrador</option>
            </select>
          </label>

          <div className="mt-1">
            <p className="text-xs font-semibold text-slate-200 mb-2 font-mono uppercase text-[10px]">Permisos Asignados:</p>
            <div className="grid gap-2 sm:grid-cols-2 max-h-32 overflow-y-auto pr-1 custom-scrollbar">
              {permissionOptions.map(([permission, label]) => (
                <label
                  key={permission}
                  className="flex cursor-pointer items-center gap-2 rounded-xl border border-cyan-500/20 bg-[#040814] px-3 py-1.5 text-[11px] text-slate-300 hover:border-cyan-500/50 transition-colors"
                >
                  <input
                    type="checkbox"
                    checked={draft.permissions.includes(permission)}
                    onChange={() => togglePermission(permission)}
                    className="h-3.5 w-3.5 accent-cyan-400 rounded"
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>
          </div>
        </div>

        {error && (
          <div className="mt-4 rounded-xl border border-red-500/40 bg-red-950/30 p-3 text-xs text-red-300 flex flex-col sm:flex-row items-center justify-between gap-2.5 shrink-0">
            <div className="flex items-center gap-2">
              <span aria-hidden="true" className="material-symbols-outlined text-red-400 text-[18px]">error</span>
              <span>{error}</span>
            </div>
            {(error.toLowerCase().includes('boveda') || error.toLowerCase().includes('bóveda') || isVaultLocked) && (
              <button
                type="button"
                onClick={() => onUnlockVaultNeeded(() => {})}
                className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs font-mono flex items-center gap-1.5 shrink-0 shadow-md cursor-pointer"
              >
                <span aria-hidden="true" className="material-symbols-outlined text-[16px]">key</span>
                <span>Desbloquear Bóveda (2FA)</span>
              </button>
            )}
          </div>
        )}

        <div className="mt-4 pt-3 border-t border-cyan-500/20 flex justify-end gap-2.5 shrink-0">
          <button type="button" onClick={onClose} disabled={saving} className="cyber-btn-secondary px-4 py-2 text-xs font-bold">
            Cancelar
          </button>
          <button
            type="submit"
            disabled={saving || !isPasswordValid || draft.name.trim().length < 2 || !draft.email.includes('@')}
            className="cyber-btn-primary px-4 py-2 text-xs font-black disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? 'Creando...' : 'Crear Colaborador'}
          </button>
        </div>
      </form>
    </div>
  );
});

// ============================================================================
// SECTION: YARD CASH RECEIVERS (Authorized Yard Employees for Cash)
// ============================================================================
interface YardReceiversSectionProps {
  receivers: YardCashReceiver[];
  onRefresh: () => void;
  showToast: (msg: string) => void;
}

const YardReceiversSection: React.FC<YardReceiversSectionProps> = React.memo(({
  receivers,
  onRefresh,
  showToast,
}) => {
  const [newName, setNewName] = useState('');
  const [newRole, setNewRole] = useState('Encargado de Patio / Yarda');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newName.trim();
    if (trimmed.length < 2) {
      setError('Ingresa un nombre válido (al menos 2 caracteres).');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const response = await apiFetch('/yard-cash-receivers', {
        method: 'POST',
        body: JSON.stringify({
          name: trimmed,
          roleLabel: newRole.trim() || 'Personal de Yarda',
          active: true,
        }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.message || 'No se pudo registrar el empleado de yarda.');
      }
      setNewName('');
      onRefresh();
      showToast(`Empleado de yarda "${trimmed}" registrado para recepción de efectivo.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al registrar empleado.');
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (receiver: YardCashReceiver) => {
    try {
      const response = await apiFetch(`/yard-cash-receivers/${receiver.id}`, {
        method: 'PUT',
        body: JSON.stringify({ active: !receiver.active }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.message || 'No se pudo actualizar el estado.');
      }
      onRefresh();
      showToast(`Estado de "${receiver.name}" actualizado.`);
    } catch (err) {
      toast({ title: 'No se pudo actualizar el estado', message: err instanceof Error ? err.message : undefined, tone: 'error' });
    }
  };

  const handleDelete = async (receiver: YardCashReceiver) => {
    const confirmed = await confirm({
      title: `¿Eliminar a "${receiver.name}"?`,
      message: 'Saldrá de la lista de receptores de efectivo en yarda.',
      confirmLabel: 'Eliminar',
      tone: 'danger',
    });
    if (!confirmed) return;
    try {
      const response = await apiFetch(`/yard-cash-receivers/${receiver.id}`, {
        method: 'DELETE',
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.message || 'No se pudo eliminar.');
      }
      onRefresh();
      showToast(`"${receiver.name}" eliminado de la lista de yarda.`);
    } catch (err) {
      toast({ title: 'No se pudo eliminar al empleado', message: err instanceof Error ? err.message : undefined, tone: 'error' });
    }
  };

  const { confirm, toast } = useFeedback();
  const activeCount = useMemo(() => receivers.filter((r) => r.active).length, [receivers]);

  return (
    <div className="relative rounded-3xl bg-[#070c18] border border-emerald-500/30 p-5 md:p-6 shadow-[0_10px_30px_rgba(0,0,0,0.5)] space-y-5">
      <div className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-transparent via-emerald-400 to-cyan-400 shadow-[0_0_10px_#10b981]" />

      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-start gap-3.5">
          <div className="w-11 h-11 rounded-2xl bg-emerald-500/15 border border-emerald-500/40 text-emerald-400 flex items-center justify-center shrink-0">
            <span aria-hidden="true" className="material-symbols-outlined text-[24px]">payments</span>
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg md:text-xl font-black text-white tracking-tight">
                Personal de Yarda · Receptores de Efectivo en Entregas
              </h2>
              <span className="text-[11px] font-mono font-bold bg-emerald-950/60 text-emerald-300 border border-emerald-500/30 px-2.5 py-0.5 rounded-full">
                {activeCount} activos
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              Registra aquí los nombres de los empleados de la yarda autorizados para recibir pagos en efectivo durante las entregas o abonos en patio. Aparecerán como botones de selección rápida al cobrar en efectivo.
            </p>
          </div>
        </div>
      </div>

      {/* Add New Yard Receiver Form */}
      <form onSubmit={handleAdd} className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end bg-[#040814] border border-emerald-500/20 rounded-2xl p-4">
        <label className="sm:col-span-5 flex flex-col gap-1.5 text-xs font-semibold text-slate-300">
          <span className="flex items-center gap-1.5">
            <span aria-hidden="true" className="material-symbols-outlined text-[15px] text-emerald-400">badge</span>
            <span>Nombre del empleado de la yarda *</span>
          </span>
          <input
            type="text"
            required
            minLength={2}
            maxLength={200}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Ej. Alejandro, Roberto Martínez..."
            className="w-full rounded-xl border border-emerald-500/30 bg-[#070c18] px-3.5 py-2 text-sm text-white outline-none focus:border-emerald-400"
          />
        </label>

        <label className="sm:col-span-4 flex flex-col gap-1.5 text-xs font-semibold text-slate-300">
          <span className="flex items-center gap-1.5">
            <span aria-hidden="true" className="material-symbols-outlined text-[15px] text-cyan-400">work</span>
            <span>Cargo o función en yarda</span>
          </span>
          <input
            type="text"
            maxLength={120}
            value={newRole}
            onChange={(e) => setNewRole(e.target.value)}
            placeholder="Ej. Encargado de Patio / Despacho"
            className="w-full rounded-xl border border-cyan-500/30 bg-[#070c18] px-3.5 py-2 text-sm text-white outline-none focus:border-cyan-400"
          />
        </label>

        <div className="sm:col-span-3">
          <button
            type="submit"
            disabled={saving || newName.trim().length < 2}
            className="w-full cyber-btn-primary px-4 py-2.5 text-xs font-black flex items-center justify-center gap-1.5 disabled:opacity-50"
          >
            <span aria-hidden="true" className="material-symbols-outlined text-[18px]">person_add</span>
            <span>{saving ? 'Guardando...' : 'Agregar Empleado'}</span>
          </button>
        </div>
      </form>

      {error && (
        <p className="rounded-xl border border-red-500/40 bg-red-950/20 px-3.5 py-2 text-xs text-red-300">
          {error}
        </p>
      )}

      {/* Registered Yard Employees Grid */}
      {receivers.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-700/80 bg-[#040814]/50 p-6 text-center text-xs text-slate-400">
          Aún no hay empleados de yarda registrados. Agrega arriba los nombres de quienes reciben efectivo en patio para seleccionarlos con 1 clic durante los cobros y entregas.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {receivers.map((receiver) => (
            <div
              key={receiver.id}
              className={`rounded-2xl border p-3.5 flex items-center justify-between gap-3 transition-all ${
                receiver.active
                  ? 'bg-[#040814] border-emerald-500/35 shadow-sm'
                  : 'bg-[#040814]/40 border-slate-800 opacity-60'
              }`}
            >
              <div className="flex items-center gap-3 min-w-0">
                <div
                  className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 font-black text-sm border font-mono ${
                    receiver.active
                      ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                      : 'bg-slate-800 text-slate-400 border-slate-700'
                  }`}
                >
                  {receiver.name.charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <strong className="text-sm font-bold text-white truncate">{receiver.name}</strong>
                    <span
                      className={`text-[10px] font-mono px-2 py-0.5 rounded-full border ${
                        receiver.active
                          ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                          : 'bg-slate-800 text-slate-400 border-slate-700'
                      }`}
                    >
                      {receiver.active ? 'Activo' : 'Inactivo'}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 truncate">{receiver.roleLabel || 'Personal de Yarda'}</p>
                </div>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => void handleToggle(receiver)}
                  className="px-2.5 py-1 rounded-lg text-[11px] font-semibold border border-cyan-500/30 text-cyan-300 hover:bg-cyan-500/15 transition-colors"
                  title={receiver.active ? 'Desactivar temporalmente' : 'Reactivar'}
                >
                  {receiver.active ? 'Pausar' : 'Activar'}
                </button>
                <button
                  type="button"
                  onClick={() => void handleDelete(receiver)}
                  className="p-1.5 rounded-lg text-red-400 hover:bg-red-950/40 border border-red-500/20 transition-colors"
                  title="Eliminar empleado"
                >
                  <span aria-hidden="true" className="material-symbols-outlined text-[15px]">delete</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
});

// ============================================================================
// MAIN USERS MANAGEMENT VIEW
// ============================================================================
interface UsersManagementViewProps {
  currentUserId?: number;
}

export const UsersManagementView: React.FC<UsersManagementViewProps> = ({ currentUserId }) => {
  const [usersList, setUsersList] = useState<ManagedUser[]>([]);
  const [yardReceivers, setYardReceivers] = useState<YardCashReceiver[]>([]);
  const [loading, setLoading] = useState(true);

  // Modals state
  const [selectedUser, setSelectedUser] = useState<ManagedUser | null>(null);
  const [modalMode, setModalMode] = useState<'edit' | 'permissions' | null>(null);
  const [isNewUserModalOpen, setIsNewUserModalOpen] = useState(false);

  // Toast Feedback
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Security Vault (2FA) for user management and password resets
  const [isUnlockModalOpen, setIsUnlockModalOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);
  const [isVaultLocked, setIsVaultLocked] = useState(false);
  const [vaultExpiresAt, setVaultExpiresAt] = useState(0);

  const { confirm, toast } = useFeedback();
  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 4000);
  }, []);

  // Parallel initial data load (Fast, unified Promise.all)
  const loadAllData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [usersRes, receiversRes, vaultRes] = await Promise.all([
        apiFetch('/users').then((r) => (r.ok ? r.json() : [])).catch(() => []),
        apiFetch('/yard-cash-receivers').then((r) => (r.ok ? r.json() : [])).catch(() => []),
        apiFetch('/auth/2fa/vault').then((r) => (r.ok ? (r.json() as Promise<{ expiresAt?: number }>) : { expiresAt: 0 })).catch(() => ({ expiresAt: 0 })),
      ]);
      setUsersList(Array.isArray(usersRes) ? usersRes : []);
      setYardReceivers(Array.isArray(receiversRes) ? receiversRes : []);
      const expiresAt = typeof vaultRes?.expiresAt === 'number' ? vaultRes.expiresAt : 0;
      setVaultExpiresAt(expiresAt);
      setIsVaultLocked(!expiresAt || expiresAt <= Date.now());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAllData();
  }, [loadAllData]);

  const handleEditUser = useCallback((user: ManagedUser, mode: 'edit' | 'permissions') => {
    setSelectedUser(user);
    setModalMode(mode);
  }, []);

  const handleCloseEditor = useCallback(() => {
    setSelectedUser(null);
    setModalMode(null);
  }, []);

  const handleUserSaved = useCallback((updated: ManagedUser) => {
    setUsersList((curr) => curr.map((u) => (u.id === updated.id ? updated : u)));
    handleCloseEditor();
    showToast(`Usuario "${updated.name}" actualizado correctamente.`);
  }, [handleCloseEditor, showToast]);

  const handleUserCreated = useCallback((created: ManagedUser) => {
    setUsersList((curr) => [created, ...curr]);
    setIsNewUserModalOpen(false);
    showToast(`Colaborador "${created.name}" creado con éxito.`);
  }, [showToast]);

  const handleDeleteUser = useCallback(async (user: ManagedUser) => {
    if (user.id === currentUserId) return;
    const confirmed = await confirm({
      title: `¿Eliminar al usuario ${user.name}?`,
      message: 'Esta acción desactivará su cuenta y lo retirará del listado.',
      confirmLabel: 'Desactivar usuario',
      tone: 'danger',
    });
    if (!confirmed) return;
    try {
      const response = await apiFetch(`/users/${user.id}`, { method: 'DELETE' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (
          payload.code === 'FINANCE_LOCKED' ||
          (response.status === 403 &&
            (payload.message?.toLowerCase().includes('boveda') || payload.message?.toLowerCase().includes('bóveda')))
        ) {
          setIsVaultLocked(true);
          setPendingAction(() => () => { void handleDeleteUser(user); });
          setIsUnlockModalOpen(true);
          return;
        }
        throw new Error(payload.message || 'No se pudo eliminar el usuario.');
      }
      setUsersList((curr) => curr.filter((u) => u.id !== user.id));
      showToast(`Usuario "${user.name}" desactivado.`);
    } catch (err) {
      toast({ title: 'No se pudo eliminar el usuario', message: err instanceof Error ? err.message : undefined, tone: 'error' });
    }
  }, [currentUserId, showToast]);

  const handleUnlockVaultNeeded = useCallback((retryAction: () => void) => {
    setIsVaultLocked(true);
    setPendingAction(() => retryAction);
    setIsUnlockModalOpen(true);
  }, []);

  const isVaultUnlocked = !isVaultLocked && vaultExpiresAt > Date.now();

  return (
    <div className="radar-view horizon-view space-y-6">
      {/* Toast Feedback */}
      {toastMessage && (
        <div className="fixed top-20 right-6 z-50 bg-emerald-400 text-slate-950 font-black text-xs py-2.5 px-4 rounded-2xl shadow-[0_0_25px_rgba(16,185,129,0.5)] flex items-center gap-2 animate-bounce border border-emerald-300">
          <span aria-hidden="true" className="material-symbols-outlined text-[18px]">verified</span>
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Cyber Header Card */}
      <div className="horizon-view-header">
        <div className="flex items-center gap-3.5">
          <div className="relative w-12 h-12 rounded-2xl bg-[#040814] border border-cyan-500/40 text-cyan-300 flex items-center justify-center shadow-[0_0_20px_rgba(6,182,212,0.3)] shrink-0">
            <span aria-hidden="true" className="material-symbols-outlined text-[26px]">manage_accounts</span>
            <span className="absolute -bottom-1 -right-1 w-3.5 h-3.5 rounded-full bg-cyan-400 shadow-[0_0_8px_#22d3ee] animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-xl md:text-2xl font-black text-white tracking-tight">Gestión de Usuarios y Accesos</h1>
              <span className="text-[11px] font-mono font-bold bg-cyan-950/60 text-cyan-300 border border-cyan-500/30 px-2.5 py-0.5 rounded-full shadow-[0_0_8px_rgba(6,182,212,0.25)]">
                Super Admin
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              Administración integral de cuentas de colaboradores, teléfonos, correos, fotos de perfil y permisos.
              {' '}Desbloquea la bóveda en Relación Semanal antes de crear, modificar o eliminar cuentas.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Security Vault Indicator / Unlock Button */}
          <button
            type="button"
            onClick={() => setIsUnlockModalOpen(true)}
            className={`px-3 py-2 rounded-xl text-xs font-mono font-bold flex items-center gap-1.5 border transition-all cursor-pointer ${
              isVaultUnlocked
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/20 shadow-sm'
                : 'bg-amber-500/15 border-amber-500/40 text-amber-300 hover:bg-amber-500/25 shadow-[0_0_15px_rgba(245,158,11,0.2)]'
            }`}
          >
            <span aria-hidden="true" className="material-symbols-outlined text-[17px]">
              {isVaultUnlocked ? 'lock_open' : 'lock'}
            </span>
            <span>
              {isVaultUnlocked ? 'Bóveda Desbloqueada' : 'Desbloquear Bóveda (2FA)'}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setIsNewUserModalOpen(true)}
            className="cyber-btn-primary px-4 py-2.5 text-xs font-black flex items-center gap-2 cursor-pointer"
          >
            <span aria-hidden="true" className="material-symbols-outlined text-[18px]">person_add</span>
            <span>Nuevo Colaborador</span>
          </button>
        </div>
      </div>

      {/* Users Table */}
      <div className="relative rounded-3xl bg-[#070c18] border border-cyan-500/25 overflow-hidden shadow-[0_10px_30px_rgba(0,0,0,0.5)]">
        <div className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-transparent via-cyan-400 to-transparent shadow-[0_0_8px_#22d3ee]" />

        <div className="table-responsive-wrapper custom-scrollbar">
          <table className="w-full text-left text-xs min-w-[760px]">
            <thead className="bg-[#040814] text-cyan-400/80 uppercase text-[10px] tracking-wider border-b border-cyan-500/20 font-mono">
              <tr>
                <th className="py-3.5 px-4">Colaborador / Perfil</th>
                <th className="py-3.5 px-4">Contacto Directo</th>
                <th className="py-3.5 px-4">Rol & Permisos</th>
                <th className="py-3.5 px-4">Última Actualización</th>
                <th className="py-3.5 px-4">Estado</th>
                <th className="py-3.5 px-4 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-cyan-500/10 text-slate-300">
              {loading && usersList.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-slate-400 font-mono">
                    <div className="inline-flex items-center gap-2 text-cyan-400">
                      <span aria-hidden="true" className="material-symbols-outlined animate-spin text-[20px]">sync</span>
                      <span>Cargando colaboradores de Radar...</span>
                    </div>
                  </td>
                </tr>
              ) : usersList.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-slate-400 font-mono">
                    No hay usuarios disponibles en radar_db.
                  </td>
                </tr>
              ) : (
                usersList.map((user) => (
                  <tr key={user.id} className="hover:bg-cyan-500/5 transition-colors">
                    <td className="py-3.5 px-4">
                      <div className="flex items-center gap-3">
                        <UserAvatar url={user.avatar_url} name={user.name} />
                        <div>
                          <div className="font-bold text-white text-sm">{user.name}</div>
                          <div className="text-[11px] text-slate-400 font-mono">{user.email}</div>
                        </div>
                      </div>
                    </td>
                    <td className="py-3.5 px-4">
                      <div className="space-y-0.5">
                        <div className="font-mono text-[11.5px] text-cyan-300 flex items-center gap-1">
                          <span aria-hidden="true" className="material-symbols-outlined text-[14px] text-cyan-400">phone</span>
                          <span>{user.phone || 'Sin registrar'}</span>
                        </div>
                        <div className="font-mono text-[10.5px] text-slate-400">{user.email}</div>
                      </div>
                    </td>
                    <td className="py-3.5 px-4">
                      <div className="flex items-center gap-2">
                        <span
                          className={`font-mono text-xs font-bold px-2.5 py-0.5 rounded-lg border ${
                            user.role === 'admin'
                              ? 'bg-purple-950/70 border-purple-500/40 text-purple-300'
                              : user.role === 'vendedor_yarda'
                              ? 'bg-amber-950/70 border-amber-500/40 text-amber-300'
                              : 'bg-cyan-950/60 border-cyan-500/30 text-cyan-300'
                          }`}
                        >
                          {user.role === 'admin'
                            ? 'Super Admin'
                            : user.role === 'vendedor_yarda'
                            ? '🚜 Vendedor Yarda'
                            : 'Operador'}
                        </span>
                        <span className="text-[10.5px] font-mono text-slate-400">
                          ({user.permissions?.length || 0} permisos)
                        </span>
                      </div>
                    </td>
                    <td className="py-3.5 px-4 font-mono text-[11px] text-slate-400">
                      {user.updated_at
                        ? new Date(user.updated_at).toLocaleString('es-MX', {
                            dateStyle: 'medium',
                            timeStyle: 'short',
                          })
                        : 'N/A'}
                    </td>
                    <td className="py-3.5 px-4">
                      <span
                        className={`text-[10px] font-mono font-bold px-2.5 py-0.5 rounded-full border flex items-center gap-1.5 w-fit ${
                          user.active ? 'neon-badge-emerald' : 'neon-badge-red'
                        }`}
                      >
                        <span className={`w-1.5 h-1.5 rounded-full ${user.active ? 'bg-emerald-400' : 'bg-red-400'}`} />
                        {user.active ? 'Activo' : 'Inactivo'}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-right">
                      <button
                        type="button"
                        onClick={() => handleEditUser(user, 'edit')}
                        className="text-slate-400 hover:text-cyan-300 font-semibold cursor-pointer mr-3 transition-colors text-xs"
                      >
                        Editar
                      </button>
                      <button
                        type="button"
                        onClick={() => handleEditUser(user, 'permissions')}
                        className="text-cyan-400 hover:text-cyan-300 font-semibold cursor-pointer mr-3 transition-colors text-xs"
                      >
                        Permisos
                      </button>
                      {user.id !== currentUserId && (
                        <button
                          type="button"
                          onClick={() => void handleDeleteUser(user)}
                          className="text-red-400 hover:text-red-300 font-semibold cursor-pointer transition-colors text-xs"
                        >
                          Eliminar
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Section: Personal de Yarda */}
      <YardReceiversSection
        receivers={yardReceivers}
        onRefresh={() => void loadAllData(true)}
        showToast={showToast}
      />

      {/* Modal: Edit User / Permissions (Isolated State) */}
      {selectedUser && modalMode && (
        <UserEditModal
          user={selectedUser}
          mode={modalMode}
          onClose={handleCloseEditor}
          onSuccess={handleUserSaved}
          onUnlockVaultNeeded={handleUnlockVaultNeeded}
          isVaultLocked={isVaultLocked}
        />
      )}

      {/* Modal: Create User (Isolated State) */}
      {isNewUserModalOpen && (
        <UserCreateModal
          onClose={() => setIsNewUserModalOpen(false)}
          onSuccess={handleUserCreated}
          onUnlockVaultNeeded={handleUnlockVaultNeeded}
          isVaultLocked={isVaultLocked}
        />
      )}

      {/* 2FA Vault Unlock Modal */}
      <VaultUnlockModal
        isOpen={isUnlockModalOpen}
        onClose={() => {
          setIsUnlockModalOpen(false);
          setPendingAction(null);
        }}
        onSuccess={(expiresAt) => {
          setVaultExpiresAt(expiresAt);
          setIsVaultLocked(false);
          setIsUnlockModalOpen(false);
          showToast('Bóveda de seguridad desbloqueada.');
          if (pendingAction) {
            const action = pendingAction;
            setPendingAction(null);
            action();
          }
        }}
        title="Desbloquear Bóveda de Seguridad (2FA)"
        description="La administración de usuarios y el restablecimiento de contraseñas requieren autorización en dos pasos (2FA) para proteger el acceso administrativo."
      />
    </div>
  );
};
