import React from 'react';

interface SecurityOtpModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  actionTitle: string;
  actionDescription: string;
  orderCode?: string;
  destinationPhone?: string;
}

// No authorization endpoint exists for this legacy flow. Never authorize locally.
export const SecurityOtpModal: React.FC<SecurityOtpModalProps> = ({ isOpen, onClose, actionTitle }) => {
  if (!isOpen) return null;
  return <div className="horizon-modal fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
    <section role="dialog" aria-modal="true" aria-label={actionTitle} className="rounded-2xl bg-slate-900 border border-amber-700 p-6 max-w-lg space-y-4">
      <h2 className="text-xl font-bold">{actionTitle}</h2>
      <p role="alert">Esta operación requiere una sesión de administrador y autorización del servidor. No hay un mecanismo OTP disponible para autorizarla desde esta ventana.</p>
      <button onClick={onClose} className="border border-slate-600 rounded-xl px-4 py-2">Cerrar</button>
    </section>
  </div>;
};
