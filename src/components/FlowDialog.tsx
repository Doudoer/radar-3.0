import React, { useRef } from 'react';
import { createPortal } from 'react-dom';
import { useDialogAccessibility } from '../hooks/useDialogAccessibility';

interface FlowDialogProps {
  open: boolean;
  onClose: () => void;
  labelledBy: string;
  icon: string;
  title: React.ReactNode;
  badge?: React.ReactNode;
  subtitle?: React.ReactNode;
  headerActions?: React.ReactNode;
  isBlocked?: () => boolean;
  maxWidthClass?: string;
  children: React.ReactNode;
}

export const FlowDialog: React.FC<FlowDialogProps> = ({
  open,
  onClose,
  labelledBy,
  icon,
  title,
  badge,
  subtitle,
  headerActions,
  isBlocked,
  maxWidthClass = 'max-w-[1120px]',
  children,
}) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogAccessibility({ open, dialogRef, onEscape: onClose, isBlocked });

  if (!open || typeof document === 'undefined') return null;

  const portalTarget = document.getElementById('root') ?? document.body;

  return createPortal(
    <div className="horizon-modal fixed inset-0 z-[90] flex items-center justify-center bg-black/85 p-2.5 backdrop-blur-xl animate-fade-in sm:p-4">
      <button
        type="button"
        tabIndex={-1}
        aria-label="Cerrar"
        onClick={onClose}
        className="horizon-drawer-backdrop absolute inset-0 cursor-default bg-black/70 backdrop-blur-sm"
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        data-flow-dialog="true"
        className={`horizon-flow-dialog relative flex max-h-[min(94vh,860px)] w-full ${maxWidthClass} flex-col overflow-hidden bg-[var(--bg-card)] text-[var(--text-primary)] outline-none`}
      >
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--border-color)] bg-[var(--bg-card)] px-4 py-3.5 sm:px-6 sm:py-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[var(--border-color)] bg-[var(--brand-soft)] text-[var(--brand)]">
              <span aria-hidden="true" className="material-symbols-outlined text-[20px]">{icon}</span>
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 id={labelledBy} className="truncate text-base font-bold tracking-tight text-[var(--text-primary)]">{title}</h2>
                {badge}
              </div>
              {subtitle && <p className="mt-0.5 truncate text-[11px] text-[var(--text-secondary)]">{subtitle}</p>}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {headerActions}
            <button
              type="button"
              onClick={onClose}
              aria-label="Cerrar"
              className="cursor-pointer rounded-lg p-2 text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-card-subtle)] hover:text-[var(--text-primary)]"
            >
              <span aria-hidden="true" className="material-symbols-outlined text-[20px]">close</span>
            </button>
          </div>
        </header>
        <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6 sm:py-5">{children}</div>
      </div>
    </div>,
    portalTarget
  );
};
