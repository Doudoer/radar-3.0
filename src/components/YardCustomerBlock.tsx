import React from 'react';
import type { Customer } from '../types';

interface YardCustomerBlockProps {
  customer?: Pick<Customer, 'name' | 'phone' | 'type' | 'company'> | null;
  phoneCopied?: boolean;
  onCopyPhone?: (phone: string) => void;
}

export const YardCustomerBlock: React.FC<YardCustomerBlockProps> = ({
  customer,
  phoneCopied = false,
  onCopyPhone,
}) => {
  const name = customer?.name?.trim() || 'Cliente sin nombre';
  const phone = customer?.phone?.trim() || '';
  const dialablePhone = phone.replace(/[^\d+]/g, '');

  return (
    <section className="rounded-2xl border border-yard-line bg-yard-surface p-4 space-y-3">
      <p className="yard-eyebrow flex items-center gap-1.5">
        <span aria-hidden="true" className="material-symbols-outlined text-[15px] text-yard-accent-strong">person</span>
        Cliente
      </p>

      <div className="flex items-start justify-between gap-2 min-w-0">
        <div className="min-w-0">
          <p className="text-[17px] leading-tight font-extrabold text-yard-ink break-words">{name}</p>
          {customer?.company && (
            <p className="mt-0.5 text-[11px] text-yard-muted break-words">{customer.company}</p>
          )}
        </div>
        {customer?.type && <span className="yard-chip shrink-0">{customer.type}</span>}
      </div>

      {phone ? (
        <div className="flex items-center gap-2">
          <a
            href={`tel:${dialablePhone}`}
            className="flex-1 min-w-0 min-h-[48px] rounded-xl bg-yard-sunken border border-yard-line px-3 flex items-center gap-2 font-mono text-[12.5px] font-bold text-yard-ink hover:border-yard-line-strong transition-colors"
          >
            <span aria-hidden="true" className="material-symbols-outlined text-[18px] text-yard-accent-strong">call</span>
            <span className="truncate">{phone}</span>
          </a>
          {onCopyPhone && (
            <button
              type="button"
              onClick={() => onCopyPhone(phone)}
              aria-label={`Copiar teléfono de ${name}`}
              className={`yard-icon-btn shrink-0 ${phoneCopied ? 'text-yard-success-strong' : ''}`}
            >
              <span aria-hidden="true" className="material-symbols-outlined text-[18px]">
                {phoneCopied ? 'check' : 'content_copy'}
              </span>
              <span className="sr-only">{phoneCopied ? '¡Copiado!' : 'Copiar'}</span>
            </button>
          )}
        </div>
      ) : (
        <div className="min-h-[48px] rounded-xl bg-yard-sunken border border-yard-line px-3 flex items-center gap-2 font-mono text-[11.5px] text-yard-muted">
          <span aria-hidden="true" className="material-symbols-outlined text-[18px]">phone_disabled</span>
          <strong className="font-bold">Sin teléfono registrado</strong>
        </div>
      )}
    </section>
  );
};
