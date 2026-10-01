import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ClaimCallsModal } from '../src/components/ClaimCallsModal';
import { Claim } from '../src/types';

const claim: Claim = {
  id: 'REC-96',
  orderId: '723276',
  orderCode: 'ORD-723276',
  customerName: 'Carlos Cueva',
  customerPhone: '9842816508',
  vehicle: '2008 Chevrolet Tahoe',
  mainPart: 'Transmisión',
  claimReason: 'La transmisión no pasa de 35 millas.',
  type: 'Reclamo de orden',
  priority: 'Media',
  status: 'Pending',
  previousOrderStatus: 'entregado',
  advisor: 'System Admin',
  createdAt: '2026-10-01T12:00:00.000Z',
  callCount: 1,
  calls: [
    {
      id: 'CALL-1',
      claimId: 'REC-96',
      callNumber: 1,
      callerName: 'Carlos Cueva',
      callerPhone: '9842816508',
      attendedBy: 'System Admin',
      conversationSummary: 'Cliente solicita actualización del diagnóstico.',
      createdAt: '2026-10-01T13:00:00.000Z',
      whatsappDispatched: false,
    },
  ],
};

describe('ClaimCallsModal', () => {
  it('does not render when closed', () => {
    const html = renderToStaticMarkup(
      <ClaimCallsModal claim={claim} isOpen={false} onClose={vi.fn()} onCallAdded={vi.fn()} />
    );

    expect(html).toBe('');
  });

  it('shows the follow-up form and existing conversation history when open', () => {
    const html = renderToStaticMarkup(
      <ClaimCallsModal claim={claim} isOpen onClose={vi.fn()} onCallAdded={vi.fn()} />
    );

    expect(html).toContain('Registrar seguimiento');
    expect(html).toContain('Cliente solicita actualización del diagnóstico.');
    expect(html).toContain('Historial de conversaciones (1)');
  });
});