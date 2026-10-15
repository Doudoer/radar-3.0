import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { DailyFollowupBriefingModal } from '../src/components/DailyFollowupBriefingModal';
import { PendingFollowupItem } from '../src/types';

const samplePendingItems: PendingFollowupItem[] = [
  {
    orderId: '577',
    orderCode: 'ORD-854857',
    advisor: 'Favio Andrade',
    customerName: 'Senor Miguel',
    customerPhone: '9197576858',
    vehicle: '2009 TOYOTA Corolla',
    mainPart: 'Transmission',
    deliveredAt: '2026-10-08T20:25:51.000Z',
    daysSinceDelivery: 5,
    currentMilestone: 'dia_7',
    milestoneLabel: 'Hito 2: Montaje & Encendido',
    urgency: 'atrasada',
    lastFollowup: null,
    totalCalls: 0,
  },
  {
    orderId: '579',
    orderCode: 'ORD-017639',
    advisor: 'David Isea',
    customerName: 'Alex Unknown',
    customerPhone: '9192250865',
    customerLanguage: 'en',
    vehicle: '2008 CHEVROLET Silverado',
    mainPart: 'Transmission',
    deliveredAt: '2026-10-08T20:25:45.000Z',
    daysSinceDelivery: 5,
    currentMilestone: 'dia_7',
    milestoneLabel: 'Hito 2: Montaje & Encendido',
    urgency: 'atrasada',
    lastFollowup: null,
    totalCalls: 0,
  },
];

describe('DailyFollowupBriefingModal', () => {
  it('does not render when closed', () => {
    const html = renderToStaticMarkup(
      <DailyFollowupBriefingModal
        isOpen={false}
        onClose={vi.fn()}
        pendingItems={samplePendingItems}
        onSelectOrder={vi.fn()}
        onRefreshPending={vi.fn().mockResolvedValue(undefined)}
        currentUserName="Favio Andrade"
        userRole="operador"
      />
    );
    expect(html).toBe('');
  });

  it('renders modal with overdue badges, phone numbers, and call buttons when open', () => {
    const html = renderToStaticMarkup(
      <DailyFollowupBriefingModal
        isOpen={true}
        onClose={vi.fn()}
        pendingItems={samplePendingItems}
        onSelectOrder={vi.fn()}
        onRefreshPending={vi.fn().mockResolvedValue(undefined)}
        currentUserName="Favio Andrade"
        userRole="operador"
      />
    );

    expect(html).toContain('Seguimiento Post-Entrega Obligatorio');
    expect(html).toContain('ORD-854857');
    expect(html).toContain('Senor Miguel');
    expect(html).toContain('🇪🇸 ES');
    expect(html).toContain('ORD-017639');
    expect(html).toContain('Alex Unknown');
    expect(html).toContain('🇺🇸 EN');
    expect(html).toContain('9197576858');
    expect(html).toContain('tel:9197576858');
    expect(html).toContain('ATRASADA');
    expect(html).toContain('Registrar Llamada');
    expect(html).toContain('Regla Operativa');
    expect(html).toContain('Actualizar');
  });

  it('renders empty celebration state when no pending items', () => {
    const html = renderToStaticMarkup(
      <DailyFollowupBriefingModal
        isOpen={true}
        onClose={vi.fn()}
        pendingItems={[]}
        onSelectOrder={vi.fn()}
        onRefreshPending={vi.fn().mockResolvedValue(undefined)}
        currentUserName="Favio Andrade"
        userRole="operador"
      />
    );

    expect(html).toContain('¡Excelente trabajo!');
    expect(html).toContain('No tienes llamadas de seguimiento pendientes');
  });
});
