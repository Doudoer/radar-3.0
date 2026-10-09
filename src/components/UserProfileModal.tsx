import React, { useState, useEffect } from 'react';
import { AuthUser } from '../hooks/useAuthSession';
import { apiFetch } from '../services/apiFetch';

export const PRESET_AVATARS = [
  { id: 'av-1', url: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=200&auto=format&fit=crop&q=80', label: 'Operador Alfa' },
  { id: 'av-2', url: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200&auto=format&fit=crop&q=80', label: 'Técnico Especialista' },
  { id: 'av-3', url: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=200&auto=format&fit=crop&q=80', label: 'Coordinadora Logística' },
  { id: 'av-4', url: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=200&auto=format&fit=crop&q=80', label: 'Asesor Comercial' },
  { id: 'av-5', url: 'https://images.unsplash.com/photo-1580489944761-15a19d654956?w=200&auto=format&fit=crop&q=80', label: 'Operaciones Radar' },
  { id: 'av-6', url: 'https://images.unsplash.com/photo-1560250097-0b93528c311a?w=200&auto=format&fit=crop&q=80', label: 'Super Administrador' },
  { id: 'av-7', url: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=200&auto=format&fit=crop&q=80', label: 'Cyber 3D' },
  { id: 'av-8', url: 'https://images.unsplash.com/photo-1628157582853-a796fa650a6a?w=200&auto=format&fit=crop&q=80', label: 'Piloto Neon' },
];

export const DEFAULT_AVATAR = PRESET_AVATARS[0].url;

interface UserProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  user: AuthUser | null;
  onUserUpdated: (updatedUser: Partial<AuthUser>) => void;
}

export const UserProfileModal: React.FC<UserProfileModalProps> = ({
  isOpen,
  onClose,
  user,
  onUserUpdated,
}) => {
  const [activeTab, setActiveTab] = useState<'profile' | 'security'>('profile');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [showCustomUrlInput, setShowCustomUrlInput] = useState(false);

  // Security password fields
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPasswords, setShowPasswords] = useState(false);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen && user) {
      setName(user.name || '');
      setEmail(user.email || '');
      setPhone(user.phone || '');
      setAvatarUrl(user.avatar_url || DEFAULT_AVATAR);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setError(null);
      setSuccessMessage(null);
      setActiveTab('profile');
    }
  }, [isOpen, user]);

  if (!isOpen || !user) return null;

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 2 * 1024 * 1024) {
      setError('La imagen no debe superar los 2MB.');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setAvatarUrl(reader.result);
        setError(null);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMessage(null);

    if (!name.trim()) {
      setError('El nombre completo es obligatorio.');
      setActiveTab('profile');
      return;
    }

    if (!email.trim() || !email.includes('@')) {
      setError('Por favor ingresa un correo electrónico válido.');
      setActiveTab('profile');
      return;
    }

    if (newPassword) {
      if (!currentPassword) {
        setError('Debes ingresar tu contraseña actual para cambiarla.');
        setActiveTab('security');
        return;
      }
      if (newPassword.length < 8) {
        setError('La nueva contraseña debe tener al menos 8 caracteres.');
        setActiveTab('security');
        return;
      }
      if (newPassword !== confirmPassword) {
        setError('La nueva contraseña y su confirmación no coinciden.');
        setActiveTab('security');
        return;
      }
    }

    setSaving(true);
    try {
      const payload: Record<string, any> = {
        name: name.trim(),
        email: email.trim().toLowerCase(),
        phone: phone.trim() || null,
        avatar_url: avatarUrl.trim() || null,
      };

      if (newPassword) {
        payload.currentPassword = currentPassword;
        payload.newPassword = newPassword;
      }

      const response = await apiFetch('/auth/profile', {
        method: 'PUT',
        body: JSON.stringify(payload),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.message || 'Error al actualizar el perfil.');
      }

      onUserUpdated({
        name: data.user.name,
        email: data.user.email,
        phone: data.user.phone,
        avatar_url: data.user.avatar_url,
      });

      setSuccessMessage('¡Perfil actualizado con éxito!');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');

      setTimeout(() => {
        onClose();
      }, 1200);
    } catch (err: any) {
      setError(err.message || 'Error de conexión.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-md animate-fade-in">
      <div className="relative w-full max-w-xl bg-[#060b18] border border-cyan-500/40 rounded-2xl shadow-[0_0_50px_rgba(6,182,212,0.25)] overflow-hidden flex flex-col max-h-[92vh]">
        {/* Top Glowing Laser Header */}
        <div className="h-1 bg-gradient-to-r from-cyan-400 via-blue-500 to-emerald-400 shadow-[0_0_12px_#22d3ee]" />

        {/* Modal Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-cyan-500/20 bg-[#091124]/90">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-cyan-950/80 border border-cyan-500/40 flex items-center justify-center text-cyan-400 shadow-[0_0_10px_rgba(34,211,238,0.3)]">
              <span className="material-symbols-outlined text-[20px]">account_circle</span>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-black text-slate-100 tracking-tight">Mi Perfil de Usuario</h3>
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-bold uppercase tracking-wider ${
                  user.role?.toLowerCase() === 'admin'
                    ? 'bg-purple-950/70 border border-purple-500/40 text-purple-300'
                    : 'bg-cyan-950/70 border border-cyan-500/40 text-cyan-300'
                }`}>
                  {user.role?.toLowerCase() === 'admin' ? 'Super Admin' : 'Operador'}
                </span>
              </div>
              <p className="text-[11px] font-mono text-cyan-400/80 mt-0.5">
                ID #{user.id || 1} • {user.email}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800/60 transition-colors cursor-pointer"
          >
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-cyan-500/20 bg-[#070e1c] px-5 pt-2 gap-2">
          <button
            type="button"
            onClick={() => setActiveTab('profile')}
            className={`pb-2.5 px-3 text-xs font-bold font-mono transition-all flex items-center gap-1.5 cursor-pointer border-b-2 ${
              activeTab === 'profile'
                ? 'border-cyan-400 text-cyan-300 drop-shadow-[0_0_8px_rgba(34,211,238,0.5)]'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <span className="material-symbols-outlined text-[16px]">badge</span>
            <span>Datos & Avatar</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('security')}
            className={`pb-2.5 px-3 text-xs font-bold font-mono transition-all flex items-center gap-1.5 cursor-pointer border-b-2 ${
              activeTab === 'security'
                ? 'border-cyan-400 text-cyan-300 drop-shadow-[0_0_8px_rgba(34,211,238,0.5)]'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <span className="material-symbols-outlined text-[16px]">lock_reset</span>
            <span>Seguridad & Contraseña</span>
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSave} className="flex-1 overflow-y-auto p-5 space-y-4 custom-scrollbar">
          {error && (
            <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/40 text-red-300 text-xs flex items-center gap-2 shadow-[0_0_15px_rgba(239,68,68,0.15)]">
              <span className="material-symbols-outlined text-[18px] shrink-0">error</span>
              <span>{error}</span>
            </div>
          )}

          {successMessage && (
            <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/40 text-emerald-300 text-xs flex items-center gap-2 shadow-[0_0_15px_rgba(16,185,129,0.15)]">
              <span className="material-symbols-outlined text-[18px] shrink-0">check_circle</span>
              <span>{successMessage}</span>
            </div>
          )}

          {activeTab === 'profile' && (
            <div className="space-y-4 animate-fade-in">
              {/* Avatar Selector Section */}
              <div className="p-4 rounded-xl bg-[#040814] border border-cyan-500/25 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-200 font-mono flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-[16px] text-cyan-400">face</span>
                    Avatar de Perfil
                  </span>
                  <label className="text-[11px] font-mono text-cyan-400 hover:text-cyan-200 cursor-pointer flex items-center gap-1">
                    <span className="material-symbols-outlined text-[14px]">upload</span>
                    <span>Subir Foto</span>
                    <input type="file" accept="image/*" onChange={handleFileUpload} className="hidden" />
                  </label>
                </div>

                <div className="flex items-center gap-4">
                  {/* Current Avatar Large Preview */}
                  <div className="relative shrink-0">
                    <div className="w-16 h-16 rounded-2xl overflow-hidden border-2 border-cyan-400 shadow-[0_0_15px_rgba(34,211,238,0.4)] bg-slate-900">
                      <img
                        src={avatarUrl || DEFAULT_AVATAR}
                        alt="Avatar Actual"
                        className="w-full h-full object-cover"
                        onError={(e) => {
                          (e.target as HTMLImageElement).src = DEFAULT_AVATAR;
                        }}
                      />
                    </div>
                    <div className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-emerald-400 border-2 border-[#060b18] shadow-[0_0_6px_#10b981]" title="En línea" />
                  </div>

                  {/* Preset Avatars Grid */}
                  <div className="flex-1">
                    <span className="text-[10px] font-mono text-slate-400 uppercase tracking-wider block mb-1.5">
                      Elegir Avatar Rápido
                    </span>
                    <div className="flex flex-wrap gap-2">
                      {PRESET_AVATARS.map((av) => (
                        <button
                          key={av.id}
                          type="button"
                          onClick={() => setAvatarUrl(av.url)}
                          title={av.label}
                          className={`w-8 h-8 rounded-xl overflow-hidden border transition-all cursor-pointer ${
                            avatarUrl === av.url
                              ? 'border-cyan-400 scale-110 shadow-[0_0_10px_#22d3ee] ring-2 ring-cyan-400/40'
                              : 'border-slate-700 opacity-60 hover:opacity-100 hover:border-cyan-500/50'
                          }`}
                        >
                          <img src={av.url} alt={av.label} className="w-full h-full object-cover" />
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Custom URL Toggle */}
                <div>
                  <button
                    type="button"
                    onClick={() => setShowCustomUrlInput(!showCustomUrlInput)}
                    className="text-[11px] text-cyan-400/80 hover:text-cyan-300 font-mono flex items-center gap-1 cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-[13px]">
                      {showCustomUrlInput ? 'expand_less' : 'add_link'}
                    </span>
                    <span>{showCustomUrlInput ? 'Ocultar URL personalizada' : 'Usar URL de imagen externa'}</span>
                  </button>
                  {showCustomUrlInput && (
                    <input
                      type="url"
                      value={avatarUrl}
                      onChange={(e) => setAvatarUrl(e.target.value)}
                      placeholder="https://ejemplo.com/mi-avatar.jpg"
                      className="mt-2 w-full bg-[#060d1d] border border-cyan-500/30 rounded-xl px-3 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400 font-mono"
                    />
                  )}
                </div>
              </div>

              {/* Name Field */}
              <div>
                <label className="block text-xs font-bold text-slate-300 font-mono mb-1.5 flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-[15px] text-cyan-400">person</span>
                  Nombre Completo *
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ej. Juan Pérez"
                  className="w-full bg-[#040814] border border-cyan-500/30 rounded-xl px-3.5 py-2.5 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400 shadow-inner font-sans"
                />
              </div>

              {/* Email Field */}
              <div>
                <label className="block text-xs font-bold text-slate-300 font-mono mb-1.5 flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-[15px] text-cyan-400">mail</span>
                  Correo Electrónico *
                </label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="usuario@radar.com"
                  className="w-full bg-[#040814] border border-cyan-500/30 rounded-xl px-3.5 py-2.5 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400 shadow-inner font-mono"
                />
              </div>

              {/* Phone Field */}
              <div>
                <label className="block text-xs font-bold text-slate-300 font-mono mb-1.5 flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-[15px] text-cyan-400">phone</span>
                  Número de Teléfono / WhatsApp
                </label>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="Ej. +1 (919) 555-0199"
                  className="w-full bg-[#040814] border border-cyan-500/30 rounded-xl px-3.5 py-2.5 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400 shadow-inner font-mono"
                />
                <span className="text-[10.5px] text-slate-400 font-mono mt-1 block">
                  Permite contacto rápido interno y seguimiento de operaciones.
                </span>
              </div>
            </div>
          )}

          {activeTab === 'security' && (
            <div className="space-y-4 animate-fade-in">
              <div className="p-3 rounded-xl bg-cyan-950/30 border border-cyan-500/20 text-cyan-300 text-xs flex items-start gap-2">
                <span className="material-symbols-outlined text-[18px] shrink-0 mt-0.5">shield</span>
                <span>
                  Solo completa los siguientes campos si deseas cambiar tu clave de acceso a RADAR V3.
                </span>
              </div>

              {/* Current Password */}
              <div>
                <label className="block text-xs font-bold text-slate-300 font-mono mb-1.5">
                  Contraseña Actual
                </label>
                <div className="relative">
                  <input
                    type={showPasswords ? 'text' : 'password'}
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full bg-[#040814] border border-cyan-500/30 rounded-xl px-3.5 py-2.5 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400 shadow-inner font-mono pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPasswords(!showPasswords)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-cyan-300 cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-[16px]">
                      {showPasswords ? 'visibility_off' : 'visibility'}
                    </span>
                  </button>
                </div>
              </div>

              {/* New Password */}
              <div>
                <label className="block text-xs font-bold text-slate-300 font-mono mb-1.5">
                  Nueva Contraseña
                </label>
                <input
                  type={showPasswords ? 'text' : 'password'}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Mínimo 8 caracteres (A-Z, a-z, 0-9, símbolo)"
                  className="w-full bg-[#040814] border border-cyan-500/30 rounded-xl px-3.5 py-2.5 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400 shadow-inner font-mono"
                />
              </div>

              {/* Confirm Password */}
              <div>
                <label className="block text-xs font-bold text-slate-300 font-mono mb-1.5">
                  Confirmar Nueva Contraseña
                </label>
                <input
                  type={showPasswords ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Repite la nueva contraseña"
                  className="w-full bg-[#040814] border border-cyan-500/30 rounded-xl px-3.5 py-2.5 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400 shadow-inner font-mono"
                />
              </div>

              {/* Password Requirements Helper */}
              <div className="p-3 rounded-xl bg-[#030712] border border-cyan-500/20 text-[11px] font-mono text-slate-400 space-y-1">
                <span className="font-bold text-slate-200 block mb-1">Requisitos de Seguridad:</span>
                <div className="flex items-center gap-1.5">
                  <span className={`material-symbols-outlined text-[13px] ${newPassword.length >= 8 ? 'text-emerald-400' : 'text-slate-600'}`}>check_circle</span>
                  <span>Mínimo 8 caracteres</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className={`material-symbols-outlined text-[13px] ${/[A-Z]/.test(newPassword) && /[a-z]/.test(newPassword) ? 'text-emerald-400' : 'text-slate-600'}`}>check_circle</span>
                  <span>Mayúsculas y minúsculas</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className={`material-symbols-outlined text-[13px] ${/[0-9]/.test(newPassword) && /[^a-zA-Z0-9]/.test(newPassword) ? 'text-emerald-400' : 'text-slate-600'}`}>check_circle</span>
                  <span>Números y símbolos especiales</span>
                </div>
              </div>
            </div>
          )}

          {/* Modal Footer Buttons */}
          <div className="pt-3 border-t border-cyan-500/20 flex items-center justify-end gap-2.5">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="px-4 py-2 rounded-xl text-xs font-bold font-mono text-slate-300 hover:text-white hover:bg-slate-800/60 border border-slate-700 transition cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2 rounded-xl text-xs font-black tracking-wide bg-gradient-to-r from-cyan-400 via-blue-500 to-emerald-400 hover:from-cyan-300 hover:to-emerald-300 text-slate-950 shadow-[0_0_15px_rgba(6,182,212,0.35)] transition cursor-pointer flex items-center gap-1.5 active:scale-95 disabled:opacity-50"
            >
              <span className="material-symbols-outlined text-[16px]">
                {saving ? 'sync' : 'save'}
              </span>
              <span>{saving ? 'Guardando...' : 'Guardar Cambios'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
