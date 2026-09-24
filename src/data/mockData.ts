import { SLAMetric } from '../types';

export const SLA_METRICS: SLAMetric[] = [
  {
    id: 'sla-1',
    name: 'Tiempo resp. leads (web)',
    status: 'healthy',
    statusLabel: 'Healthy',
    value: '12m',
    target: '< 15m',
  },
  {
    id: 'sla-2',
    name: 'Entrega Taller (Reparación)',
    status: 'attention',
    statusLabel: 'Attention',
    value: '48h avg',
    target: '< 36h',
  },
  {
    id: 'sla-3',
    name: 'Aprobación Financiamiento',
    status: 'overdue',
    statusLabel: 'Overdue (4)',
    value: '>72h',
    target: '< 24h',
  },
  {
    id: 'sla-4',
    name: 'Cierre de ticket (Soporte)',
    status: 'healthy',
    statusLabel: 'Healthy',
    value: '4.2h',
    target: '< 6h',
  },
];
