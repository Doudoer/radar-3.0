import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { Order, RefundRequest } from '../src/types';

const hooks = vi.hoisted(() => ({ values: [] as any[], cursor: 0 }));
vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  const useState = (initial: any) => {
    const index = hooks.cursor++;
    if (!(index in hooks.values)) hooks.values[index] = typeof initial === 'function' ? initial() : initial;
    return [hooks.values[index], (next: any) => {
      hooks.values[index] = typeof next === 'function' ? next(hooks.values[index]) : next;
    }];
  };
  const useRef = (initial: any) => {
    const index = hooks.cursor++;
    if (!(index in hooks.values)) hooks.values[index] = { current: initial };
    return hooks.values[index];
  };
  const overrides = { useState, useRef, useEffect: () => {}, useCallback: (fn: any) => fn, useMemo: (fn: any) => fn() };
  return { ...actual, ...overrides, default: { ...actual, ...overrides } };
});

vi.mock('../src/services/apiFetch', () => ({ apiFetch: vi.fn() }));
import { apiFetch } from '../src/services/apiFetch';
import { RefundRequestView } from '../src/components/RefundRequestView';
import { RefundsView } from '../src/components/RefundsView';
import { ClaimsView } from '../src/components/ClaimsView';
import { SecurityOtpModal } from '../src/components/SecurityOtpModal';
import { useOrderActions } from '../src/hooks/useOrderActions';
import { ordersApi } from '../src/services/ordersApi';
import { DashboardView } from '../src/components/DashboardView';
import { useFinanceMovements } from '../src/hooks/useFinanceState';
import { OrderInventoryAvailability } from '../src/components/OrderInventoryAvailability';

const order = {
  id: '18', version: 3, code: 'ORD-18', status: 'pagado',
  customer: { name: 'Cliente', phone: '5551234567', email: 'cliente@example.test' },
  vehicle: { year: 2020, make: 'Ford', model: 'F150' },
  mainPart: 'Motor', financials: { partPrice: 100, downPayment: 100 },
} as Order;
const refund: RefundRequest = {
  id: 'REF-4', orderId: '18', orderCode: 'ORD-18', customerName: 'Cliente', vehicle: 'Ford', part: 'Motor',
  reason: 'Devolución', amount: 25, amountType: 'custom', paymentMethod: 'Zelle', paymentDetails: 'Cuenta',
  status: 'pending', createdAt: '2026-11-01',
};

const render = (component: any, props: any) => {
  hooks.cursor = 0;
  return component(props);
};
const nodes = (node: any): any[] => {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!node || typeof node !== 'object') return [];
  return [node, ...nodes(node.props?.children)];
};
const text = (node: any): string => {
  if (Array.isArray(node)) return node.map(text).join('');
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node !== 'object') return String(node);
  return text(node.props?.children);
};
const click = (tree: any, label: string) => {
  const button = nodes(tree).find((node) => node.type === 'button' && text(node) === label);
  expect(button, label).toBeTruthy();
  return button.props.onClick();
};

describe('persisted frontend flows', () => {
  beforeEach(() => {
    hooks.values = [];
    hooks.cursor = 0;
    vi.restoreAllMocks();
    vi.mocked(apiFetch).mockReset();
    vi.stubGlobal('window', new EventTarget());
  });

  it('refreshes operational orders and financial movements together from the dashboard', async () => {
    vi.mocked(apiFetch).mockResolvedValue(new Response('[]'));
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    const tree = render(DashboardView, {
      orders: [], activities: [], onSelectOrder: vi.fn(), onNavigateTaller: vi.fn(), onRefresh,
    });
    const refresh = nodes(tree).find(node => node.props?.title === 'Actualizar telemetría');
    expect(refresh).toBeTruthy();
    await refresh.props.onClick();
    expect(onRefresh).toHaveBeenCalledOnce();
    expect(apiFetch).toHaveBeenCalledWith('/analytics/income');
  });

  it('clears previously loaded financial movements when server access is revoked', async () => {
    const movements = [{ id: 1, orderId: '18', kind: 'payment', amount: 25, effectiveAt: '2026-11-02T12:00:00Z', source: 'order_payment' }];
    vi.mocked(apiFetch).mockResolvedValueOnce(new Response(JSON.stringify(movements)))
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: 'Bóveda bloqueada' }), { status: 403 }));
    let result = render(useFinanceMovements, true);
    expect(await result.refresh()).toBe(true);
    result = render(useFinanceMovements, true);
    expect(result.loaded).toBe(true);
    expect(result.movements).toEqual(movements);
    expect(await result.refresh()).toBe(false);
    result = render(useFinanceMovements, true);
    expect(result.loaded).toBe(false);
    expect(result.movements).toEqual([]);
    expect(result.error).toBe('Bóveda bloqueada');
  });

  it('requires explicit selection and compatibility confirmation before reserving inventory', async () => {
    const availableOrder: Order = { ...order, inventoryAvailability: {
      state: 'possible', availableCount: 1, candidates: [{
        part: { id: '4', year: '2020', brand: 'Ford', model: 'F150', partType: 'Motor', status: 'disponible' },
        level: 'possible', reasons: ['Marca y modelo coinciden'], pendingChecks: ['Verificar motor'],
      }],
    } };
    hooks.values = [availableOrder, '', true, '', false, false];
    let tree = render(OrderInventoryAvailability, { order: availableOrder, userRole: 'admin' });
    const reserveButton = (value: any) => nodes(value).find(node => node.type === 'button' && text(node) === 'Vincular y reservar pieza');
    expect(reserveButton(tree).props.disabled).toBe(true);
    nodes(tree).find(node => node.type === 'input' && node.props.type === 'radio').props.onChange();
    tree = render(OrderInventoryAvailability, { order: availableOrder, userRole: 'admin' });
    expect(reserveButton(tree).props.disabled).toBe(true);
    nodes(tree).find(node => node.type === 'input' && node.props.type === 'checkbox').props.onChange({ target: { checked: true } });
    tree = render(OrderInventoryAvailability, { order: availableOrder, userRole: 'admin' });
    expect(reserveButton(tree).props.disabled).toBe(false);
    vi.mocked(apiFetch).mockResolvedValue(new Response(JSON.stringify({
      ...availableOrder, version: 4, inventoryPartId: 4,
      inventoryAvailability: { state: 'linked', availableCount: 0, candidates: [] },
    })));
    await reserveButton(tree).props.onClick();
    // The event handler starts the async operation without returning its promise.
    await vi.waitFor(() => expect(apiFetch).toHaveBeenCalledWith('/orders/18/inventory', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ inventoryPartId: 4, version: 3, confirmedCompatibility: true }),
    })));
  });

  it('keeps refund input and the same UUID after a failed POST; success emits refresh without a PUT', async () => {
    const onUpdateOrder = vi.fn();
    const onSuccess = vi.fn();
    const changed = vi.fn();
    window.addEventListener('radar:data-changed', changed);
    const props = { order, onBack: vi.fn(), onUpdateOrder, onSuccess };
    const failed = () => Promise.resolve(new Response(JSON.stringify({ message: 'Conflicto financiero' }), { status: 409 }));
    vi.mocked(apiFetch).mockImplementationOnce(failed).mockResolvedValueOnce(new Response(JSON.stringify({ id: 'REF-4' })));
    let tree = render(RefundRequestView, props);
    await nodes(tree).find((node) => node.type === 'form').props.onSubmit({ preventDefault() {} });
    expect(onSuccess).not.toHaveBeenCalled();
    tree = render(RefundRequestView, props);
    expect(text(tree)).toContain('Conflicto financiero');
    await nodes(tree).find((node) => node.type === 'form').props.onSubmit({ preventDefault() {} });
    const payloads = vi.mocked(apiFetch).mock.calls.map(([, options]) => JSON.parse(String(options?.body)));
    expect(payloads[0].idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
    expect(payloads[0]).toEqual(payloads[1]);
    expect(payloads[0].orderId).toBe('18');
    expect(onUpdateOrder).not.toHaveBeenCalled();
    expect(onSuccess).toHaveBeenCalledOnce();
    expect(changed).toHaveBeenCalledOnce();
    expect(vi.mocked(apiFetch).mock.calls.every(([path]) => path === '/refunds')).toBe(true);
  });

  it('lists only real refund requests; historical orders are informative and not actionable', () => {
    hooks.values[0] = [refund];
    hooks.values[1] = true;
    const legacy = { ...order, id: '19', code: 'LEGACY-19', status: 'reembolsado' } as Order;
    let tree = render(RefundsView, { orders: [order, legacy], userRole: 'operador' });
    expect(text(tree)).toContain('REF-4');
    expect(text(tree)).toContain('LEGACY-19');
    expect(text(tree)).toContain('solo informativo');
    expect(text(tree)).not.toContain('Confirmar pago');
    tree = render(RefundsView, { orders: [order, legacy], userRole: 'admin' });
    expect(nodes(tree).filter((node) => node.type === 'button' && text(node) === 'Confirmar pago')).toHaveLength(1);
  });

  it('awaits refund confirmation and preserves pending state on failure', async () => {
    hooks.values[0] = [refund];
    hooks.values[1] = true;
    const props = { orders: [order], userRole: 'admin' };
    vi.mocked(apiFetch).mockResolvedValue(new Response(JSON.stringify({ message: 'No autorizado' }), { status: 403 }));
    await click(render(RefundsView, props), 'Confirmar pago');
    await vi.waitFor(() => expect(text(render(RefundsView, props))).toContain('No autorizado'));
    expect(hooks.values[0][0].status).toBe('pending');
    expect(apiFetch).toHaveBeenCalledOnce();
    expect(JSON.parse(String(vi.mocked(apiFetch).mock.calls[0][1]?.body))).toEqual({ status: 'completed' });
  });

  it('has a claims-only screen and never locally authorizes an OTP action', () => {
    expect(text(render(ClaimsView, { orders: [order] }))).not.toMatch(/reembolso/i);
    const onSuccess = vi.fn();
    const tree = SecurityOtpModal({ isOpen: true, onClose: vi.fn(), onSuccess, actionTitle: 'Cambio', actionDescription: '' });
    expect(text(tree)).toContain('No hay un mecanismo OTP disponible');
    expect(nodes(tree).filter((node) => node.type === 'input')).toHaveLength(0);
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('rethrows the original persistence error instead of resolving as a successful null', async () => {
    const failure = new Error('La orden cambió (409)');
    vi.spyOn(ordersApi, 'update').mockRejectedValue(failure);
    const message = vi.fn();
    const replaceOrder = vi.fn();
    const actions = useOrderActions({
      orders: [order], setOrders: vi.fn(), setDatabaseMessage: message, replaceOrder, prependOrder: vi.fn(),
    });
    await expect(actions.updateOrder(order)).rejects.toBe(failure);
    expect(message).toHaveBeenCalledWith(failure.message);
    expect(replaceOrder).not.toHaveBeenCalled();
  });

  it('awaits creation before deleting the persisted draft or closing the order editor', () => {
    const source = readFileSync(new URL('../src/components/NewOrderModal.tsx', import.meta.url), 'utf8');
    const submit = source.slice(source.indexOf('const handleSubmit = async'));
    expect(submit.indexOf('await onCreateOrder(savedOrder)')).toBeLessThan(submit.indexOf('clearOrderDraft()'));
    expect(submit.indexOf('await onUpdateOrder(savedOrder)')).toBeLessThan(submit.indexOf('onClose()'));
    expect(submit).toContain('savingRef.current');
    expect(submit).toContain('setStepError(error instanceof Error ? error.message');
  });
});
