import React from 'react';
import { ActivityItem } from '../types';

interface NotificationsDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  activities: ActivityItem[];
  onSelectOrder: (orderId: string) => void;
}

export const NotificationsDrawer: React.FC<NotificationsDrawerProps> = ({
  isOpen,
  onClose,
  activities,
  onSelectOrder,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-hidden">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed inset-y-0 right-0 max-w-full flex pl-10">
        <div className="w-screen max-w-md bg-[#181b25] border-l border-[rgba(255,255,255,0.08)] shadow-2xl flex flex-col">
          {/* Header */}
          <div className="p-4 border-b border-[rgba(255,255,255,0.08)] flex justify-between items-center bg-[#1c1f29]">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-[#4d8eff] text-[20px]">notifications</span>
              <h3 className="font-headline-sm text-base font-bold text-[#dfe2ef]">
                Centro de Notificaciones & Alertas
              </h3>
            </div>
            <button
              onClick={onClose}
              className="text-[#c2c6d6] hover:text-white p-1 rounded hover:bg-[#31353f] transition-colors cursor-pointer"
            >
              <span className="material-symbols-outlined text-[18px]">close</span>
            </button>
          </div>

          {/* SLA Alerts banner */}
          <div className="p-3 bg-[#ef4444]/10 border-b border-[#ef4444]/20 flex items-center gap-2.5">
            <span className="material-symbols-outlined text-[#ef4444] text-[18px] shrink-0">timer_off</span>
            <div className="text-xs">
              <span className="font-semibold text-[#ef4444] block">4 Alertas de SLA Activas</span>
              <span className="text-[#c2c6d6]">Aprobaciones de financiamiento demoradas más de 72h.</span>
            </div>
          </div>

          {/* List */}
          <div className="p-4 overflow-y-auto flex-1 flex flex-col gap-2.5 text-xs">
            {(activities || []).map((item) => {
              let iconBg = 'bg-[#4d8eff] text-[#00285d]';
              if (item.type === 'workshop') iconBg = 'bg-[#f59e0b]/20 text-[#f59e0b] border border-[#f59e0b]/30';
              if (item.type === 'lead') iconBg = 'bg-[#4edea3]/20 text-[#4edea3] border border-[#4edea3]/30';
              if (item.type === 'alert') iconBg = 'bg-[#ef4444]/20 text-[#ef4444] border border-[#ef4444]/30';

              return (
                <div
                  key={item.id}
                  onClick={() => {
                    onSelectOrder('ORD-8924A');
                    onClose();
                  }}
                  className="p-3 rounded-xl bg-[#0a0e17] hover:bg-[#31353f]/50 border border-[rgba(255,255,255,0.06)] flex gap-3 transition-colors cursor-pointer"
                >
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${iconBg}`}>
                    <span className="material-symbols-outlined text-[16px]">{item.icon}</span>
                  </div>
                  <div className="flex-1">
                    <p className="text-[#dfe2ef] font-medium leading-snug">{item.title}</p>
                    <p className="text-[#c2c6d6] text-[11px] mt-0.5">{item.description}</p>
                    <span className="font-data-label text-[10px] text-[#adc6ff] block mt-1">
                      {item.timeAgo}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="p-4 border-t border-[rgba(255,255,255,0.08)] bg-[#1c1f29] text-center">
            <button
              onClick={onClose}
              className="w-full py-2 bg-[#31353f] hover:bg-[#353943] text-[#dfe2ef] rounded-lg text-xs font-medium transition-colors cursor-pointer"
            >
              Marcar todas como leídas
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
