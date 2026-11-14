import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { Order, OrderStatus, YardCompatibility } from '../types';
import { apiFetch } from '../services/apiFetch';
import { CancelOrderModal } from './CancelOrderModal';
import { YardCompatibilityModal } from './YardCompatibilityModal';
import { YardPhotoGallery } from './YardPhotoGallery';
import { YardCustomerBlock } from './YardCustomerBlock';
import { expandYearRangesInText } from '../utils/compatibilityFormat';
import { yardQueueCountsFromOrders, type YardQueueCounts, type YardQueueTab } from '../utils/yardQueue';

const createIdempotencyKey = () => {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  } catch {
    // Fall back to a timestamp-based key on non-secure contexts.
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
};

const formatYardAging = (iso: string | undefined, kind: 'paid' | 'ready' | 'claim' = 'paid') => {
  if (!iso) return null;
  const started = Date.parse(iso);
  if (!Number.isFinite(started)) return null;
  const days = Math.max(0, Math.floor((Date.now() - started) / 86_400_000));
  const noun = kind === 'ready' ? 'Lista' : kind === 'claim' ? 'Reclamo' : 'Pagada';
  const label = days === 0 ? `${noun} hoy` : days === 1 ? `${noun} hace 1 día` : `${noun} hace ${days} días`;
  // La antigüedad es urgencia operativa: ámbar, nunca rojo (el rojo se reserva a lo destructivo).
  const tone = days >= 7 ? 'amber-strong' : days >= 3 ? 'amber' : 'slate';
  return { days, label, tone };
};

const isYardEligibleOrder = (o: Order) => o.status === 'pagado' || o.status === 'reclamo';
const isYardPendingOrder = (o: Order) => o.status === 'pagado' && !o.yardPieceReady;

const YARD_TABS: YardQueueTab[] = ['all', 'pending_yard', 'yard_ready', 'claims', 'yard_sales'];

const YARD_TAB_META: Record<YardQueueTab, { label: string; title: string; description: string; icon: string }> = {
  all: { label: 'Todas', title: 'Toda la cola', description: 'Pagadas y reclamos', icon: 'list_alt' },
  pending_yard: { label: 'Pendientes', title: 'Pendientes', description: 'Por preparar en patio', icon: 'build_circle' },
  yard_ready: { label: 'Listas', title: 'Listas en patio', description: 'Pendientes de retiro', icon: 'check_circle' },
  claims: { label: 'Reclamos', title: 'Reclamos', description: 'Piezas de cambio', icon: 'report_problem' },
  yard_sales: { label: 'Ventas', title: 'Ventas de patio', description: 'Vendidas por yarda', icon: 'point_of_sale' },
};

const readYardTabFromUrl = (): YardQueueTab => {
  if (typeof window === 'undefined') return 'pending_yard';
  const requested = new URLSearchParams(window.location.search).get('tab') as YardQueueTab | null;
  return requested && YARD_TABS.includes(requested) ? requested : 'pending_yard';
};

interface YardPortalViewProps {
  orders: Order[];
  currentUser?: { id?: number; name?: string; email?: string; role?: string } | null;
  onLogout: () => void;
  onRefreshOrders?: () => Promise<boolean | void>;
  onUpdateOrder?: (updatedOrder: Order) => Promise<Order | void>;
  onToggleOffice?: () => void;
  loadError?: string | null;
  serverCounts?: YardQueueCounts | null;
  hasMoreYardOrders?: boolean;
  isLoadingMoreYardOrders?: boolean;
  isSearchingYardOrders?: boolean;
  onLoadMoreYardOrders?: () => Promise<unknown>;
  onSearchYardOrders?: (query: string) => void | Promise<unknown>;
}

export const YardPortalView: React.FC<YardPortalViewProps> = ({
  orders,
  currentUser,
  onLogout,
  onRefreshOrders,
  onUpdateOrder,
  onToggleOffice,
  loadError,
  serverCounts,
  hasMoreYardOrders = false,
  isLoadingMoreYardOrders = false,
  isSearchingYardOrders = false,
  onLoadMoreYardOrders,
  onSearchYardOrders,
}) => {
  const isSuperAdmin = currentUser?.role === 'admin';
  const [searchQuery, setSearchQuery] = useState('');
  const [filterTab, setFilterTab] = useState<YardQueueTab>(readYardTabFromUrl);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [isCancelModalOpen, setIsCancelModalOpen] = useState(false);
  const [orderToCancel, setOrderToCancel] = useState<Order | null>(null);
  const [markingReadyId, setMarkingReadyId] = useState<string | null>(null);
  const [revertingYardReadyId, setRevertingYardReadyId] = useState<string | null>(null);
  const [markingUnavailableId, setMarkingUnavailableId] = useState<string | null>(null);
  const [markingClaimReadyId, setMarkingClaimReadyId] = useState<string | null>(null);
  const [revertingClaimReadyId, setRevertingClaimReadyId] = useState<string | null>(null);
  const [orderForClaimReady, setOrderForClaimReady] = useState<Order | null>(null);
  const [orderForClaimRevert, setOrderForClaimRevert] = useState<Order | null>(null);
  const [orderForRevert, setOrderForRevert] = useState<Order | null>(null);
  const [orderForReady, setOrderForReady] = useState<Order | null>(null);
  const [orderForUnavailable, setOrderForUnavailable] = useState<Order | null>(null);
  const [orderForUnavailableInfo, setOrderForUnavailableInfo] = useState<Order | null>(null);
  const [unavailableReason, setUnavailableReason] = useState<string>('');
  const [toastData, setToastData] = useState<{ text: string; type: 'success' | 'warning' | 'error' } | null>(null);
  const [orderForCompatibility, setOrderForCompatibility] = useState<Order | null>(null);
  const [isCompatibilityModalOpen, setIsCompatibilityModalOpen] = useState(false);
  const [photoLightboxIndex, setPhotoLightboxIndex] = useState<number | null>(null);
  const [copiedField, setCopiedField] = useState<'vin' | 'phone' | null>(null);

  // Pull-to-refresh mobile gesture state
  const [pullStartY, setPullStartY] = useState(0);
  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Bottom-sheet swipe-down to dismiss gesture state
  const [sheetStartY, setSheetStartY] = useState(0);
  const [sheetTranslateY, setSheetTranslateY] = useState(0);

  // Keep the open detail in sync with the live order list so refreshes and SSE
  // updates never leave a stale snapshot (and closed orders close the sheet).
  const selectedOrder = useMemo(
    () => orders.find((order) => order.id === selectedOrderId) || null,
    [orders, selectedOrderId]
  );

  const detailAging = selectedOrder
    ? formatYardAging(
        selectedOrder.status === 'reclamo'
          ? (selectedOrder.claimLoggedAt || selectedOrder.createdAtIso)
          : (selectedOrder.paidAtIso || selectedOrder.createdAtIso),
        selectedOrder.status === 'reclamo' ? 'claim' : 'paid'
      )
    : null;
  const detailStatusTone = selectedOrder?.status === 'reclamo'
    ? (selectedOrder.claimPieceReady ? 'ready' : 'claim')
    : selectedOrder?.yardPieceReady ? 'ready' : 'pending';
  const detailStatusLabel = selectedOrder?.status === 'reclamo'
    ? (selectedOrder.claimPieceReady ? 'CAMBIO LISTO' : 'RECLAMO')
    : selectedOrder?.yardPieceReady ? 'LISTA EN PATIO' : 'POR PREPARAR';

  const toastTimerRef = useRef<number | null>(null);
  const copyTimerRef = useRef<number | null>(null);
  const showToast = (msg: string, type: 'success' | 'warning' | 'error' = 'success') => {
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    setToastData({ text: msg, type });
    toastTimerRef.current = window.setTimeout(() => {
      setToastData(null);
      toastTimerRef.current = null;
    }, 4000);
  };

  useEffect(() => () => {
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
  }, []);

  const triggerHaptic = (ms = 15) => {
    if (typeof window !== 'undefined' && 'navigator' in window && navigator.vibrate) {
      try {
        navigator.vibrate(ms);
      } catch {
        // Ignore haptic failures
      }
    }
  };

  const selectFilterTab = (tab: YardQueueTab) => {
    triggerHaptic(10);
    setFilterTab(tab);
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.set('tab', tab);
      window.history.replaceState(window.history.state, '', url);
    }
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const refreshOrders = async (): Promise<boolean> => {
    if (!onRefreshOrders || isRefreshing) return false;
    setIsRefreshing(true);
    try {
      const ok = await onRefreshOrders();
      if (ok === false) {
        showToast('No se pudo actualizar la cola de patio', 'error');
        return false;
      }
      showToast('Órdenes actualizadas');
      return true;
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'No se pudo actualizar la cola de patio', 'error');
      return false;
    } finally {
      setIsRefreshing(false);
    }
  };

  const anyModalOpen = Boolean(
    isCompatibilityModalOpen || isCancelModalOpen || orderForUnavailableInfo ||
    orderForUnavailable || orderForReady || orderForRevert || orderForClaimReady ||
    orderForClaimRevert
  );
  const overlayOpen = Boolean(selectedOrderId) || anyModalOpen;

  // El modal de compatibilidad decide si puede cerrarse: si hay ediciones sin guardar
  // muestra su propia confirmación en vez de descartarlas.
  const compatibilityCloseRequestRef = useRef<(() => void) | null>(null);
  const registerCompatibilityCloseRequest = useCallback((handler: (() => void) | null) => {
    compatibilityCloseRequestRef.current = handler;
  }, []);

  const closeTopOverlay = useCallback((): 'dialog' | 'sheet' | null => {
    if (photoLightboxIndex !== null) { setPhotoLightboxIndex(null); return 'dialog'; }
    if (isCompatibilityModalOpen) {
      compatibilityCloseRequestRef.current?.();
      return 'dialog';
    }
    if (isCancelModalOpen) { setIsCancelModalOpen(false); setOrderToCancel(null); return 'dialog'; }
    if (orderForUnavailableInfo) { setOrderForUnavailableInfo(null); return 'dialog'; }
    if (orderForUnavailable) { setOrderForUnavailable(null); setUnavailableReason(''); return 'dialog'; }
    if (orderForReady) { setOrderForReady(null); return 'dialog'; }
    if (orderForRevert) { setOrderForRevert(null); return 'dialog'; }
    if (orderForClaimReady) { setOrderForClaimReady(null); return 'dialog'; }
    if (orderForClaimRevert) { setOrderForClaimRevert(null); return 'dialog'; }
    if (selectedOrderId) { setSelectedOrderId(null); return 'sheet'; }
    return null;
  }, [
    photoLightboxIndex,
    isCompatibilityModalOpen, isCancelModalOpen, orderForUnavailableInfo,
    orderForUnavailable, orderForReady, orderForRevert, orderForClaimReady,
    orderForClaimRevert, selectedOrderId,
  ]);

  const overlayStateRef = useRef({ sheet: false, dialog: false });
  overlayStateRef.current = { sheet: Boolean(selectedOrderId), dialog: anyModalOpen };
  const closeTopOverlayRef = useRef(closeTopOverlay);
  closeTopOverlayRef.current = closeTopOverlay;

  // Close the sheet automatically if its order leaves the yard queue or is deleted.
  useEffect(() => {
    if (selectedOrderId && !selectedOrder) setSelectedOrderId(null);
  }, [selectedOrderId, selectedOrder]);

  // El visor de fotos vive dentro del detalle: nunca debe sobrevivir al cambio o cierre del sheet.
  useEffect(() => {
    setPhotoLightboxIndex(null);
  }, [selectedOrderId]);

  // One history entry per open overlay: Android back closes the top-most dialog,
  // then the sheet, without stacking entries on every data refresh.
  useEffect(() => {
    if (!overlayOpen) return;
    window.history.pushState({ modal: 'yard-overlay' }, '');
    const handlePopState = () => {
      const closed = closeTopOverlayRef.current();
      if (closed === 'dialog' && overlayStateRef.current.sheet) {
        window.history.pushState({ modal: 'yard-overlay' }, '');
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
      if (window.history.state?.modal === 'yard-overlay') {
        window.history.back();
      }
    };
  }, [overlayOpen]);

  useEffect(() => {
    if (!overlayOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      closeTopOverlayRef.current();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [overlayOpen]);

  // Enfoca la capa superior y mantiene el tabulador dentro de ella: el fondo queda inerte.
  const overlayDepthKey = [
    selectedOrderId ?? '',
    photoLightboxIndex === null ? '' : `photo-${photoLightboxIndex}`,
    orderForUnavailableInfo?.id ?? '',
    orderForUnavailable?.id ?? '',
    orderForReady?.id ?? '',
    orderForRevert?.id ?? '',
    orderForClaimReady?.id ?? '',
    orderForClaimRevert?.id ?? '',
    isCancelModalOpen ? 'cancel' : '',
    isCompatibilityModalOpen ? 'compat' : '',
  ].join('|');

  useEffect(() => {
    if (!overlayOpen) return;
    const topDialog = () => {
      const dialogs = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]'));
      return dialogs[dialogs.length - 1] ?? null;
    };
    const focusablesOf = (dialog: HTMLElement) => Array.from(
      dialog.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])')
    ).filter((el) => el.offsetParent !== null);

    const previousFocus = document.activeElement as HTMLElement | null;
    const focusTimer = window.setTimeout(() => {
      const dialog = topDialog();
      // Focus the surface itself so touch users don't see a ring on the first control.
      if (dialog?.hasAttribute('tabindex')) {
        dialog.focus({ preventScroll: true });
        return;
      }
      focusablesOf(dialog ?? document.body)[0]?.focus({ preventScroll: true });
    }, 60);

    const handleTab = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const dialog = topDialog();
      if (!dialog) return;
      const focusables = focusablesOf(dialog);
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (!dialog.contains(document.activeElement)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleTab, true);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener('keydown', handleTab, true);
      previousFocus?.focus?.({ preventScroll: true });
    };
  }, [overlayOpen, overlayDepthKey]);

  const handleCloseDetail = useCallback(() => {
    triggerHaptic(10);
    closeTopOverlayRef.current();
  }, []);

  const handleCompatibilitySaved = async (orderId: string, updatedCompat: YardCompatibility) => {
    const orderToUpdate = orders.find((o) => o.id === orderId);
    if (orderToUpdate && onUpdateOrder) {
      await onUpdateOrder({ ...orderToUpdate, yardCompatibility: updatedCompat });
    }
  };

  // Solo las órdenes pagadas y los reclamos pertenecen a esta vista
  const eligibleOrders = useMemo(() => {
    return orders.filter(isYardEligibleOrder);
  }, [orders]);

  // Filtrado de órdenes (FIFO: la pieza pagada más antigua primero)
  const filteredOrders = useMemo(() => {
    let result = eligibleOrders;

    if (filterTab === 'pending_yard') {
      result = result.filter(isYardPendingOrder);
    } else if (filterTab === 'yard_ready') {
      result = result.filter((o) => o.status === 'pagado' && Boolean(o.yardPieceReady));
    } else if (filterTab === 'claims') {
      result = result.filter((o) => o.status === 'reclamo');
    } else if (filterTab === 'yard_sales') {
      result = result.filter((o) => Boolean(o.isYardSale || o.advisorRole === 'vendedor_yarda'));
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter((o) => {
        const code = (o.code || '').toLowerCase();
        const vin = (o.vehicle?.vin || '').toLowerCase();
        const part = (o.mainPart || '').toLowerCase();
        const customer = (o.customer?.name || '').toLowerCase();
        const phone = (o.customer?.phone || '').toLowerCase();
        const stock = (o.stockNumber || '').toLowerCase();
        const makeModel = `${o.vehicle?.year || ''} ${o.vehicle?.make || ''} ${o.vehicle?.model || ''}`.toLowerCase();
        return (
          code.includes(q) ||
          vin.includes(q) ||
          part.includes(q) ||
          customer.includes(q) ||
          phone.includes(q) ||
          stock.includes(q) ||
          makeModel.includes(q)
        );
      });
    }

    return [...result].sort((a, b) => {
      const relevantTime = (order: Order) => Date.parse(
        filterTab === 'yard_ready'
          ? (order.yardPieceReadyAt || order.paidAtIso || order.createdAtIso || '')
          : filterTab === 'claims' || order.status === 'reclamo'
            ? (order.claimLoggedAt || order.createdAtIso || '')
            : (order.paidAtIso || order.createdAtIso || '')
      );
      const aTime = relevantTime(a);
      const bTime = relevantTime(b);
      const safeA = Number.isFinite(aTime) ? aTime : 0;
      const safeB = Number.isFinite(bTime) ? bTime : 0;
      return safeA - safeB;
    });
  }, [eligibleOrders, filterTab, searchQuery]);

  // Contadores para pestañas (el servidor los entrega cuando la cola está paginada)
  const localCounts = useMemo(() => yardQueueCountsFromOrders(eligibleOrders), [eligibleOrders]);
  const counts = serverCounts ?? localCounts;
  const activeTab = YARD_TAB_META[filterTab];

  // La búsqueda server-side espera a que el operador deje de escribir
  useEffect(() => {
    if (!onSearchYardOrders) return;
    const timer = window.setTimeout(() => {
      void onSearchYardOrders(searchQuery.trim());
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchQuery, onSearchYardOrders]);

  // Confirmar pieza lista en patio
  const handleMarkYardReady = async (order: Order) => {
    setMarkingReadyId(order.id);
    triggerHaptic(20);
    try {
      const response = await apiFetch(`/orders/${order.id}/yard-ready`, {
        method: 'POST',
        body: JSON.stringify({ version: order.version || 1, idempotencyKey: createIdempotencyKey() }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'No se pudo marcar la pieza en yarda.');

      const notified = Number(data.notifiedRecipients) || 0;
      const notifiedNote = notified > 0
        ? ` Se encoló aviso para ${notified} contacto(s) por WhatsApp.`
        : ' No se encontraron teléfonos de asesores/admin para avisar.';
      showToast(
        data.cleanedImagesCount > 0
          ? `¡Pieza #${order.code} lista! Se limpiaron ${data.cleanedImagesCount} fotos.${notifiedNote}`
          : `¡Pieza #${order.code} confirmada como lista en patio!${notifiedNote}`
      );
      window.dispatchEvent(new Event('radar:data-changed'));
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Error al marcar pieza en yarda', 'error');
    } finally {
      setMarkingReadyId(null);
    }
  };

  // Revertir una confirmación de pieza lista hecha por error (solo administradores)
  const handleRevertYardReady = async (order: Order) => {
    setRevertingYardReadyId(order.id);
    triggerHaptic(20);
    try {
      const response = await apiFetch(`/orders/${order.id}/revert-yard-ready`, {
        method: 'POST',
        body: JSON.stringify({ version: order.version || 1, idempotencyKey: createIdempotencyKey() }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'No se pudo revertir la pieza lista.');

      setOrderForRevert(null);
      showToast(`↩️ Orden #${order.code} devuelta a Pendientes de patio.`);
      window.dispatchEvent(new Event('radar:data-changed'));
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Error al revertir la pieza lista', 'error');
    } finally {
      setRevertingYardReadyId(null);
    }
  };

  // Notificar a asesores y administradores que la pieza de cambio está lista
  const handleNotifyClaimPieceReady = async (order: Order) => {
    setMarkingClaimReadyId(order.id);
    triggerHaptic(20);
    try {
      const response = await apiFetch(`/orders/${order.id}/claim-ready`, {
        method: 'POST',
        body: JSON.stringify({ version: order.version || 1, idempotencyKey: createIdempotencyKey() }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'No se pudo notificar la pieza de cambio.');

      const notified = Number(data.notifiedRecipients) || 0;
      setOrderForClaimReady(null);
      showToast(
        notified > 0
          ? `🔔 Pieza de cambio de #${order.code} encolada para ${notified} contacto(s) por WhatsApp.`
          : `🔔 Pieza de cambio de #${order.code} marcada como lista, pero no hay teléfonos de asesores/admin para avisar.`,
        notified > 0 ? 'success' : 'warning'
      );
      window.dispatchEvent(new Event('radar:data-changed'));
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Error al notificar la pieza de cambio', 'error');
    } finally {
      setMarkingClaimReadyId(null);
    }
  };

  // Revertir la notificación de pieza de cambio (solo administradores)
  const handleRevertClaimReady = async (order: Order) => {
    setRevertingClaimReadyId(order.id);
    triggerHaptic(20);
    try {
      const response = await apiFetch(`/orders/${order.id}/revert-claim-ready`, {
        method: 'POST',
        body: JSON.stringify({ version: order.version || 1, idempotencyKey: createIdempotencyKey() }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'No se pudo revertir la pieza de cambio.');

      setOrderForClaimRevert(null);
      showToast(`↩️ Aviso de pieza de cambio de #${order.code} revertido. Vuelve a pendiente de cambio.`);
      window.dispatchEvent(new Event('radar:data-changed'));
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Error al revertir la pieza de cambio', 'error');
    } finally {
      setRevertingClaimReadyId(null);
    }
  };

  // Reportar pieza no disponible en patio físico
  const handleMarkYardUnavailable = async (order: Order, reason?: string) => {
    setMarkingUnavailableId(order.id);
    triggerHaptic(25);
    try {
      const finalReason = (reason || unavailableReason || 'Pieza no encontrada en inventario físico').trim();
      const response = await apiFetch(`/orders/${order.id}/yard-unavailable`, {
        method: 'POST',
        body: JSON.stringify({
          reason: finalReason,
          version: order.version || 1,
          idempotencyKey: createIdempotencyKey(),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'No se pudo reportar la pieza como no disponible.');

      setOrderForUnavailable(null);
      setUnavailableReason('');
      showToast(`⚠️ Pieza #${order.code} reportada NO disponible. Subasta activada y alerta encolada para Asesor y Admin.`);
      window.dispatchEvent(new Event('radar:data-changed'));
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Error al reportar pieza', 'error');
    } finally {
      setMarkingUnavailableId(null);
    }
  };

  // Copiar datos de contacto al portapapeles
  const copyText = async (text: string): Promise<boolean> => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch {
      // Contextos sin permiso de portapapeles caen al método clásico.
    }
    try {
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      const copied = document.execCommand('copy');
      document.body.removeChild(area);
      return copied;
    } catch {
      return false;
    }
  };

  const flashCopied = (field: 'vin' | 'phone') => {
    setCopiedField(field);
    if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
    copyTimerRef.current = window.setTimeout(() => {
      setCopiedField(null);
      copyTimerRef.current = null;
    }, 2000);
  };

  const handleCopyVin = async (vinText?: string) => {
    if (!vinText) return;
    if (!(await copyText(vinText))) {
      showToast('No se pudo copiar el VIN', 'error');
      return;
    }
    flashCopied('vin');
    triggerHaptic(15);
    showToast('VIN copiado');
  };

  const handleCopyPhone = async (phoneText: string) => {
    if (!phoneText) return;
    if (!(await copyText(phoneText))) {
      showToast('No se pudo copiar el teléfono', 'error');
      return;
    }
    flashCopied('phone');
    triggerHaptic(15);
    showToast('Teléfono copiado');
  };

  // Pull-to-refresh touch handlers (disabled while a sheet or dialog is open)
  const handleTouchStart = (e: React.TouchEvent) => {
    if (overlayOpen || window.scrollY !== 0) {
      setPullStartY(0);
      return;
    }
    setPullStartY(e.touches[0].clientY);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (overlayOpen || pullStartY <= 0 || window.scrollY !== 0) return;
    const currentY = e.touches[0].clientY;
    const diff = currentY - pullStartY;
    if (diff > 0) {
      setPullDistance(Math.min(diff * 0.4, 85));
    }
  };

  const handleTouchEnd = async () => {
    if (overlayOpen) {
      setPullDistance(0);
      setPullStartY(0);
      return;
    }
    if (pullDistance >= 60 && onRefreshOrders && !isRefreshing) {
      triggerHaptic(25);
      try {
        await refreshOrders();
      } finally {
        setPullDistance(0);
        setPullStartY(0);
      }
    } else {
      setPullDistance(0);
      setPullStartY(0);
    }
  };

  // Bottom Sheet drag handlers (Swipe down to dismiss)
  const handleSheetTouchStart = (e: React.TouchEvent) => {
    setSheetStartY(e.touches[0].clientY);
  };

  const handleSheetTouchMove = (e: React.TouchEvent) => {
    if (sheetStartY > 0) {
      const diff = e.touches[0].clientY - sheetStartY;
      if (diff > 0) {
        setSheetTranslateY(diff);
      }
    }
  };

  const handleSheetTouchEnd = () => {
    if (sheetTranslateY > 110) {
      handleCloseDetail();
    }
    setSheetTranslateY(0);
    setSheetStartY(0);
  };

  return (
    <div
      className="yard-app yard-mobile-shell min-h-screen min-h-[100dvh] flex flex-col font-sans select-none antialiased"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {/* Toast Notification */}
      {toastData && (
        <div
          role={toastData.type === 'error' ? 'alert' : 'status'}
          aria-live={toastData.type === 'error' ? 'assertive' : 'polite'}
          aria-atomic="true"
          style={{ top: 'max(12px, env(safe-area-inset-top, 12px))' }}
          className={`fixed left-1/2 -translate-x-1/2 z-[100] w-[calc(100%-24px)] max-w-md rounded-[20px] px-4 py-3 text-xs font-mono font-bold shadow-[0_16px_40px_rgba(15,23,42,0.2)] flex items-center gap-2.5 animate-sheet-up border ${
            toastData.type === 'error'
              ? 'bg-yard-danger-soft text-yard-danger-strong border-yard-danger'
              : toastData.type === 'warning'
              ? 'bg-yard-accent-soft text-yard-accent-strong border-yard-accent'
              : 'bg-yard-success-soft text-yard-success-strong border-yard-success'
          }`}
        >
          <span aria-hidden="true" className="material-symbols-outlined text-[20px] shrink-0">
            {toastData.type === 'error' ? 'error' : toastData.type === 'warning' ? 'warning' : 'check_circle'}
          </span>
          <span className="leading-snug">{toastData.text}</span>
        </div>
      )}

      {/* Pull-to-refresh Visual Indicator */}
      {pullDistance > 0 && (
        <div
          style={{ height: `${pullDistance}px` }}
          className="flex items-center justify-center overflow-hidden transition-all duration-75 bg-yard-surface border-b border-yard-line"
        >
          <div className="flex items-center gap-2 text-xs font-mono font-bold text-yard-accent-strong">
            <span aria-hidden="true"
              className="material-symbols-outlined text-[22px] transition-transform"
              style={{ transform: `rotate(${pullDistance * 4}deg)` }}
            >
              autorenew
            </span>
            <span>{pullDistance >= 60 ? 'Suelta para actualizar' : 'Desliza para actualizar'}</span>
          </div>
        </div>
      )}

      {/* App bar + búsqueda: una sola superficie sticky, como app nativa */}
      <div className="sticky top-0 z-40 bg-yard-bg backdrop-blur-xl border-b border-yard-line">
        <header className="safe-top-padded px-3 sm:px-4 max-w-3xl mx-auto w-full">
          <div className="flex items-center justify-between gap-2 py-1.5">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-yard-success" aria-hidden="true" />
                <span className="yard-eyebrow whitespace-nowrap">RADAR · Patio</span>
                {isSuperAdmin && (
                  <span className="hidden min-[360px]:inline-flex">
                    <span className="yard-chip yard-chip--accent">Admin</span>
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 mt-0.5 min-w-0">
                <h1 className="text-[19px] sm:text-[21px] font-black leading-tight tracking-tight text-yard-ink truncate">
                  {activeTab.title}
                </h1>
                <span className="yard-count shrink-0" aria-label={`${counts[filterTab]} órdenes en esta bandeja`}>
                  {counts[filterTab]}
                </span>
              </div>
              <p className="text-[10.5px] font-mono text-yard-muted truncate">
                {activeTab.description}
                {currentUser?.name ? ` · ${currentUser.name}` : ''}
              </p>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              {onRefreshOrders && (
                <button
                  type="button"
                  onClick={() => {
                    triggerHaptic(10);
                    void refreshOrders();
                  }}
                  title="Actualizar datos"
                  aria-label="Actualizar datos del patio"
                  className="yard-icon-btn"
                >
                  <span aria-hidden="true" className={`material-symbols-outlined text-[21px] ${isRefreshing ? 'animate-spin text-amber-500' : ''}`}>
                    refresh
                  </span>
                </button>
              )}

              {isSuperAdmin && (
                <button
                  type="button"
                  onClick={onToggleOffice ? onToggleOffice : () => { window.location.assign(window.location.origin); }}
                  title="Ir a Radar Oficina"
                  aria-label="Ir a Radar Oficina"
                  className="yard-icon-btn"
                >
                  <span aria-hidden="true" className="material-symbols-outlined text-[21px]">domain</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => {
                  triggerHaptic(10);
                  onLogout();
                }}
                title="Cerrar sesión"
                aria-label="Cerrar sesión"
                className="yard-icon-btn text-yard-danger-strong"
              >
                <span aria-hidden="true" className="material-symbols-outlined text-[21px]">logout</span>
              </button>
            </div>
          </div>
        </header>

        <div className="px-3 sm:px-4 pb-2.5 max-w-3xl mx-auto w-full">
          <div className="relative">
            <span aria-hidden="true" className="material-symbols-outlined absolute left-3.5 top-1/2 -translate-y-1/2 text-yard-muted text-[20px] pointer-events-none">
              search
            </span>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar cliente, marca, modelo, año, pallet, orden o VIN"
              aria-label="Buscar órdenes de patio por cliente, marca, modelo, año, pallet, número de orden o VIN"
              className="yard-field"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => {
                  triggerHaptic(10);
                  setSearchQuery('');
                }}
                aria-label="Limpiar búsqueda"
                className="absolute right-1.5 top-1/2 -translate-y-1/2 w-11 h-11 rounded-lg text-yard-muted hover:text-yard-ink flex items-center justify-center active:scale-95 transition-all cursor-pointer"
              >
                <span aria-hidden="true" className="material-symbols-outlined text-[20px]">cancel</span>
              </button>
            )}
          </div>
          {isSearchingYardOrders && (
            <p role="status" className="mt-1.5 text-[10.5px] font-mono font-bold text-yard-accent-strong">
              Buscando en toda la cola de patio…
            </p>
          )}
        </div>
      </div>

      {loadError && (
        <div
          role="alert"
          aria-live="assertive"
          className="relative z-30 mx-3 mt-2 rounded-2xl border-2 border-amber-500/60 bg-amber-950/95 px-4 py-3 text-amber-200 shadow-[0_0_24px_rgba(245,158,11,0.25)] flex items-start gap-3"
        >
          <span aria-hidden="true" className="material-symbols-outlined text-[22px] text-amber-400 shrink-0">cloud_off</span>
          <div className="min-w-0 flex-1">
            <p className="font-mono font-black text-xs uppercase tracking-wide">No se pudo actualizar la cola de patio</p>
            <p className="text-[11px] mt-0.5 break-words">{loadError}</p>
          </div>
          {onRefreshOrders && (
            <button
              type="button"
              onClick={() => { void refreshOrders(); }}
              disabled={isRefreshing}
              className="shrink-0 rounded-xl border border-amber-500/60 bg-amber-500/20 px-3 py-2 text-[10px] font-mono font-black uppercase tracking-wide text-amber-200 hover:bg-amber-500/30 disabled:opacity-60 active:scale-95 transition-all cursor-pointer"
            >
              {isRefreshing ? 'Reintentando…' : 'Reintentar'}
            </button>
          )}
        </div>
      )}

      {/* Main Container */}
      <main className="flex-1 max-w-3xl w-full mx-auto px-3 sm:px-5 pt-3 space-y-3 pb-32">
        {/* Orders Feed */}
        {filteredOrders.length === 0 ? (
          <div className="yard-card p-8 text-center space-y-2">
            <div className="w-14 h-14 mx-auto rounded-2xl bg-yard-sunken border border-yard-line flex items-center justify-center text-yard-muted">
              <span aria-hidden="true" className="material-symbols-outlined text-[28px]">inbox</span>
            </div>
            <p className="text-sm font-bold text-yard-ink">Sin órdenes en esta bandeja</p>
            <p className="text-xs text-yard-muted">
              {searchQuery.trim() ? 'Prueba con otro término o limpia la búsqueda.' : 'Cambia de pestaña para ver otras piezas.'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 items-start">
            {filteredOrders.map((order) => {
              const isReadyInYard = Boolean(order.yardPieceReady);
              const refImages = order.yardCompatibility?.referenceImages || [];
              const agingKind: 'paid' | 'ready' | 'claim' = order.status === 'reclamo'
                ? 'claim'
                : (filterTab === 'yard_ready' || isReadyInYard) ? 'ready' : 'paid';
              const aging = formatYardAging(
                agingKind === 'ready'
                  ? order.yardPieceReadyAt
                  : agingKind === 'claim'
                    ? (order.claimLoggedAt || order.createdAtIso)
                    : (order.paidAtIso || order.createdAtIso),
                agingKind
              );
              const isClaim = order.status === 'reclamo';
              const cardTone = isClaim ? 'claim' : isReadyInYard ? 'ready' : 'pending';
              const statusTone = isClaim
                ? (order.claimPieceReady ? 'ready' : 'claim')
                : isReadyInYard ? 'ready' : 'pending';
              const statusLabel = isClaim
                ? (order.claimPieceReady ? 'CAMBIO LISTO' : 'PIEZA PENDIENTE')
                : isReadyInYard ? 'LISTA EN PATIO' : 'POR PREPARAR';
              const statusIcon = isClaim
                ? (order.claimPieceReady ? 'task_alt' : 'report_problem')
                : isReadyInYard ? 'check_circle' : 'pending_actions';
              const isYardSale = Boolean(order.isYardSale || order.advisorRole === 'vendedor_yarda');
              const vehicleLine = [order.vehicle?.year, order.vehicle?.make, order.vehicle?.model, order.vehicle?.trim]
                .filter(Boolean)
                .join(' ');

              return (
                <article
                  key={order.id}
                  onClick={() => {
                    triggerHaptic(10);
                    setSelectedOrderId(order.id);
                  }}
                  className={`yard-card yard-card--${cardTone} p-3 sm:p-4 active:scale-[0.99] transition-transform touch-manipulation cursor-pointer`}
                >
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedOrderId(order.id);
                    }}
                    className="sr-only focus:not-sr-only focus:absolute focus:right-2 focus:top-2 focus:z-10 focus:px-2.5 focus:py-1 focus:rounded-lg focus:bg-amber-500 focus:text-slate-950 focus:font-mono focus:font-bold focus:text-xs"
                  >
                    Ver detalle de la orden {order.code}
                  </button>

                  <div className="space-y-2.5">
                    {/* Código y antigüedad */}
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-[12px] sm:text-[12.5px] font-black tracking-tight text-yard-muted whitespace-nowrap">
                        #{order.code}
                      </span>
                      {aging && (
                        <span className={`yard-chip shrink-0 ${aging.tone === 'slate' ? '' : 'yard-chip--accent'}`}>
                          <span aria-hidden="true" className="material-symbols-outlined text-[13px]">schedule</span>
                          {aging.label}
                        </span>
                      )}
                    </div>

                    {/* Estado grande: Pagado / Reclamo */}
                    <div className="flex items-center justify-between gap-2">
                      <p className={`min-w-0 truncate text-[26px] sm:text-[28px] leading-none font-black uppercase tracking-tight ${isClaim ? 'text-yard-accent-strong' : 'text-yard-ink'}`}>
                        {isClaim ? 'Reclamo' : 'Pagado'}
                      </p>
                      <span className={`yard-status yard-status--${statusTone} shrink-0`}>
                        <span aria-hidden="true" className="material-symbols-outlined text-[13px]">{statusIcon}</span>
                        {statusLabel}
                      </span>
                    </div>

                    {/* Cliente, pieza y vehículo */}
                    <div className="min-w-0">
                      <p className="text-[16px] leading-tight font-extrabold text-yard-ink truncate">
                        {order.customer?.name || 'Cliente sin nombre'}
                      </p>
                      <p className="text-[14px] leading-snug font-bold text-yard-ink-soft truncate">
                        {order.mainPart}
                      </p>
                      <p className="mt-0.5 text-[11px] leading-snug font-mono font-bold text-yard-accent-strong truncate">
                        {vehicleLine}
                      </p>
                    </div>

                    {/* Datos de patio que el operador necesita de un vistazo */}
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="yard-chip yard-chip--accent">
                        <span aria-hidden="true" className="material-symbols-outlined text-[13px]">shelves</span>
                        {order.stockNumber ? order.stockNumber.toUpperCase() : 'PALLET PENDIENTE'}
                      </span>
                      {order.vehicle?.transmission && (
                        <span className="yard-chip">{order.vehicle.transmission}</span>
                      )}
                      {order.vehicle?.vin && (
                        <span className="yard-chip">VIN · {order.vehicle.vin.slice(-8)}</span>
                      )}
                      {refImages.length > 0 && (
                        <span className="yard-chip">
                          <span aria-hidden="true" className="material-symbols-outlined text-[13px]">photo_library</span>
                          {refImages.length} fotos
                        </span>
                      )}
                      {order.yardCompatibility?.compatibilityList && (
                        <span className="yard-chip yard-chip--info">
                          <span aria-hidden="true" className="material-symbols-outlined text-[13px]">swap_horiz</span>
                          Compatible
                        </span>
                      )}
                      {isYardSale && (
                        <span className="yard-chip yard-chip--info">
                          <span aria-hidden="true" className="material-symbols-outlined text-[13px]">agriculture</span>
                          Patio
                        </span>
                      )}
                    </div>

                    {/* Aviso de subasta: siempre visible y accionable */}
                    {order.status === 'pagado' && order.yardPieceUnavailable && !isReadyInYard && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setOrderForUnavailableInfo(order);
                        }}
                        className="w-full flex items-center gap-2 rounded-xl border border-yard-accent bg-yard-accent-soft px-3 py-2 text-left active:scale-[0.99] transition-transform cursor-pointer"
                      >
                        <span aria-hidden="true" className="material-symbols-outlined text-[18px] text-yard-accent-strong shrink-0">warning</span>
                        <span className="min-w-0">
                          <span className="block text-[10.5px] font-mono font-black text-yard-accent-strong uppercase tracking-wide">
                            No disponible · Subasta activa
                          </span>
                          <span className="block text-[10.5px] text-yard-muted truncate">
                            {order.yardPieceUnavailableReason || 'Toca para ver el detalle'}
                          </span>
                        </span>
                      </button>
                    )}

                    {/* Acciones de patio: primaria visible, secundarias en el detalle */}
                    {order.status === 'pagado' && (
                      !isReadyInYard ? (
                        <button
                          type="button"
                          disabled={markingReadyId === order.id || markingUnavailableId === order.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            setOrderForReady(order);
                          }}
                          aria-label="Confirmar Pieza Lista en Patio"
                          className="yard-btn yard-btn--primary w-full px-3"
                        >
                          <span aria-hidden="true" className="material-symbols-outlined text-[19px]">build_circle</span>
                          <span className="truncate">
                            {markingReadyId === order.id ? 'Confirmando...' : 'Confirmar pieza lista'}
                          </span>
                        </button>
                      ) : (
                        <div className="min-h-[48px] rounded-xl bg-yard-success-soft border border-yard-success flex items-center justify-center gap-1.5 px-3 text-[11px] font-mono font-black text-yard-success-strong">
                          <span aria-hidden="true" className="material-symbols-outlined text-[18px]">check_circle</span>
                          <span className="truncate">Lista · pendiente de retiro</span>
                        </div>
                      )
                    )}

                    {isClaim && (
                      order.claimPieceReady ? (
                        <div className="min-h-[48px] rounded-xl bg-yard-success-soft border border-yard-success flex items-center justify-center gap-1.5 px-3 text-[11px] font-mono font-black text-yard-success-strong">
                          <span aria-hidden="true" className="material-symbols-outlined text-[18px]">task_alt</span>
                          <span className="truncate">Cambio notificado</span>
                        </div>
                      ) : (
                        <div className="pt-0.5">
                          <button
                            type="button"
                            disabled={markingClaimReadyId === order.id}
                            onClick={(e) => {
                              e.stopPropagation();
                              setOrderForClaimReady(order);
                            }}
                            aria-label="Notificar Pieza de Cambio Lista"
                            className="yard-btn yard-btn--success w-full px-3"
                          >
                            <span aria-hidden="true" className="material-symbols-outlined text-[19px]">campaign</span>
                            <span className="truncate">
                              {markingClaimReadyId === order.id ? 'Notificando...' : 'Notificar pieza de cambio'}
                            </span>
                          </button>
                        </div>
                      )
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}

        {serverCounts && !searchQuery.trim() && (
          <p role="status" className="text-center text-[10px] font-mono text-yard-muted pt-1">
            Mostrando {filteredOrders.length} de {counts[filterTab]} en esta pestaña
          </p>
        )}

        {serverCounts && searchQuery.trim() && !isSearchingYardOrders && (
          <p role="status" className="text-center text-[10px] font-mono text-yard-accent-strong pt-1 break-words">
            {filteredOrders.length === 0
              ? 'Sin coincidencias en toda la cola de patio'
              : `Mostrando ${filteredOrders.length} ${filteredOrders.length === 1 ? 'resultado' : 'resultados'} en toda la cola`}
          </p>
        )}

        {hasMoreYardOrders && onLoadMoreYardOrders && (
          <button
            type="button"
            onClick={() => { void onLoadMoreYardOrders(); }}
            disabled={isLoadingMoreYardOrders}
            className="yard-btn yard-btn--ghost w-full"
          >
            <span aria-hidden="true" className={`material-symbols-outlined text-[18px] ${isLoadingMoreYardOrders ? 'animate-spin' : ''}`}>
              {isLoadingMoreYardOrders ? 'progress_activity' : 'expand_more'}
            </span>
            <span>
              {isLoadingMoreYardOrders
                ? 'Cargando más órdenes…'
                : searchQuery.trim() ? 'Cargar más resultados' : 'Cargar más órdenes'}
            </span>
          </button>
        )}
      </main>

      {/* DETALLE DE ORDEN: BOTTOM SHEET (móvil) / MODAL CENTRADO (tablet/desktop) */}
      {selectedOrder && (
        <div className="yard-overlay fixed inset-0 z-50 flex flex-col justify-end sm:items-center sm:justify-center sm:p-6 bg-black/85 backdrop-blur-md animate-fade-in font-sans">
          <div
            role="dialog"
            aria-modal="true"
            tabIndex={-1}
            aria-label={`Detalle de la orden ${selectedOrder.code}`}
            style={{
              transform: sheetTranslateY > 0 ? `translateY(${sheetTranslateY}px)` : undefined,
              transition: sheetTranslateY > 0 ? 'none' : 'transform 0.2s ease-out',
            }}
            className="yard-sheet max-h-[92dvh] w-full max-w-2xl mx-auto flex flex-col animate-sheet-up sm:max-h-[88dvh] sm:max-w-xl sm:overflow-hidden"
          >
            {/* Grabber: solo en móvil, donde el sheet se desliza para cerrar */}
            <div
              onTouchStart={handleSheetTouchStart}
              onTouchMove={handleSheetTouchMove}
              onTouchEnd={handleSheetTouchEnd}
              className="sm:hidden pt-3 pb-1 cursor-grab active:cursor-grabbing flex flex-col items-center select-none"
            >
              <div className="w-12 h-1.5 rounded-full bg-yard-line-strong" />
            </div>

            {/* Header compacto: código + estado, con dos salidas claras */}
            <div className="flex items-center gap-2 px-3 sm:px-4 py-2.5 border-b border-yard-line">
              <button
                type="button"
                onClick={handleCloseDetail}
                aria-label="Volver a la cola de patio"
                className="yard-icon-btn shrink-0"
              >
                <span aria-hidden="true" className="material-symbols-outlined text-[20px]">arrow_back</span>
              </button>

              <div className="min-w-0 flex-1 text-center sm:text-left">
                <div className="flex flex-wrap items-center justify-center sm:justify-start gap-x-2 gap-y-1 min-w-0">
                  <span className="font-mono text-[15px] sm:text-base font-black text-yard-ink break-all">
                    #{selectedOrder.code}
                  </span>
                  <span className={`yard-status yard-status--${detailStatusTone} shrink-0`}>
                    <span aria-hidden="true" className="material-symbols-outlined text-[12px]">
                      {detailStatusTone === 'ready' ? 'check_circle' : detailStatusTone === 'claim' ? 'report_problem' : 'pending_actions'}
                    </span>
                    {detailStatusLabel}
                  </span>
                </div>
                <p className="mt-0.5 text-[10.5px] font-mono text-yard-muted break-words">
                  Detalle de patio · {selectedOrder.mainPart}
                </p>
              </div>

              <button
                type="button"
                onClick={handleCloseDetail}
                aria-label="Cerrar detalle"
                className="yard-icon-btn shrink-0"
              >
                <span aria-hidden="true" className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            {/* Contenido desplazable: secciones agrupadas sobre el fondo del patio */}
            <div className="flex-1 overflow-y-auto bg-yard-bg p-3 sm:p-4 space-y-3 custom-scrollbar">
              {/* Fotos primero: es la verificación que patio necesita al abrir la pieza */}
              <section className="rounded-2xl border border-yard-line bg-yard-surface p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="yard-eyebrow flex items-center gap-1.5">
                    <span aria-hidden="true" className="material-symbols-outlined text-[15px] text-yard-accent-strong">photo_library</span>
                    Fotos de referencia
                  </p>
                  {isSuperAdmin && (
                    <button
                      type="button"
                      onClick={() => {
                        setOrderForCompatibility(selectedOrder);
                        setIsCompatibilityModalOpen(true);
                      }}
                      className="yard-btn yard-btn--primary px-3 text-[11px] shrink-0"
                    >
                      <span aria-hidden="true" className="material-symbols-outlined text-[18px]">photo_camera</span>
                      <span>Tomar foto</span>
                    </button>
                  )}
                </div>

                {selectedOrder.yardCompatibility?.referenceImages && selectedOrder.yardCompatibility.referenceImages.length > 0 ? (
                  <div className="space-y-1.5">
                    <YardPhotoGallery
                      images={selectedOrder.yardCompatibility.referenceImages}
                      maxThumbnails={4}
                      lightboxIndex={photoLightboxIndex}
                      onLightboxIndexChange={setPhotoLightboxIndex}
                    />
                    <p className="text-[10.5px] font-mono text-yard-muted">
                      {selectedOrder.yardCompatibility.referenceImages.length} adjuntas · Toca una foto para ampliar
                    </p>
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-yard-line-strong bg-yard-sunken px-4 py-5 text-center">
                    <span aria-hidden="true" className="material-symbols-outlined text-[22px] text-yard-muted">hide_image</span>
                    <p className="mt-1 text-[11.5px] font-bold text-yard-ink-soft">Sin fotos de referencia</p>
                    <p className="text-[10.5px] text-yard-muted">
                      {isSuperAdmin
                        ? 'Toma la primera foto con la cámara.'
                        : 'La oficina puede agregarlas desde el sistema.'}
                    </p>
                  </div>
                )}

                <div className="pt-3 border-t border-yard-line space-y-1.5">
                  <p className="yard-eyebrow">Modelos compatibles</p>
                  {selectedOrder.yardCompatibility?.compatibilityList ? (
                    <p className="rounded-xl bg-yard-sunken border border-yard-line px-3 py-2.5 font-mono text-[11px] leading-relaxed text-yard-ink-soft whitespace-pre-line">
                      {expandYearRangesInText(selectedOrder.yardCompatibility.compatibilityList)}
                    </p>
                  ) : (
                    <p className="text-[11px] italic text-yard-muted">Sin lista de compatibilidad registrada.</p>
                  )}
                </div>
              </section>

              {/* Reclamo activo: urgencia operativa en ámbar, nunca rojo */}
              {selectedOrder.status === 'reclamo' && (
                <div className="rounded-2xl border border-yard-accent bg-yard-accent-soft p-4 space-y-2">
                  <div className="flex items-center gap-2 text-yard-accent-strong">
                    <span aria-hidden="true" className="material-symbols-outlined text-[18px]">report_problem</span>
                    <span className="font-mono text-[10.5px] font-black uppercase tracking-wide">Reclamo activo</span>
                  </div>
                  {selectedOrder.claimReason && (
                    <p className="text-[13px] font-bold text-yard-ink leading-snug">{selectedOrder.claimReason}</p>
                  )}
                  {selectedOrder.notes && (
                    <p className="text-[11px] text-yard-ink-soft leading-relaxed whitespace-pre-line">{selectedOrder.notes}</p>
                  )}
                </div>
              )}

              {/* Ubicación: el dato que el operador necesita primero */}
              <section className="yard-card yard-card--pending p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="yard-eyebrow flex items-center gap-1.5">
                      <span aria-hidden="true" className="material-symbols-outlined text-[15px] text-yard-accent-strong">shelves</span>
                      Ubicación en patio
                    </p>
                    <p className="mt-1.5 font-mono text-[25px] leading-none font-black text-yard-ink break-all">
                      {selectedOrder.stockNumber ? selectedOrder.stockNumber.toUpperCase() : 'PENDIENTE'}
                    </p>
                    <p className="mt-2 text-[11px] text-yard-muted">
                      Asesor · <span className="font-bold text-yard-ink-soft">{selectedOrder.advisor || 'Sin asignar'}</span>
                    </p>
                  </div>
                  {detailAging && (
                    <div className="text-right shrink-0">
                      <p className="yard-eyebrow">Ingreso</p>
                      <p className={`mt-1.5 font-mono text-[11px] font-bold ${
                        detailAging.tone === 'slate' ? 'text-yard-muted' : 'text-yard-accent-strong'
                      }`}>
                        {detailAging.label}
                      </p>
                    </div>
                  )}
                </div>
              </section>

              <YardCustomerBlock
                customer={selectedOrder.customer}
                phoneCopied={copiedField === 'phone'}
                onCopyPhone={(phone) => { void handleCopyPhone(phone); }}
              />

              {/* Vehículo y pieza */}
              <section className="rounded-2xl border border-yard-line bg-yard-surface p-4 space-y-3">
                <p className="yard-eyebrow flex items-center gap-1.5">
                  <span aria-hidden="true" className="material-symbols-outlined text-[15px] text-yard-accent-strong">directions_car</span>
                  Vehículo y pieza
                </p>
                <div className="min-w-0">
                  <h2 className="text-[17px] leading-tight font-extrabold text-yard-ink">{selectedOrder.mainPart}</h2>
                  <p className="mt-0.5 text-[13px] font-bold text-yard-accent-strong leading-snug">
                    {[selectedOrder.vehicle?.year, selectedOrder.vehicle?.make, selectedOrder.vehicle?.model, selectedOrder.vehicle?.trim].filter(Boolean).join(' ') || 'Vehículo sin datos'}
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div className="min-w-0 rounded-xl bg-yard-sunken border border-yard-line px-3 py-2.5">
                    <p className="yard-eyebrow">Transmisión</p>
                    <p className="mt-1 font-mono text-[12px] font-bold text-yard-ink truncate">
                      {selectedOrder.vehicle?.transmission || 'N/D'}
                    </p>
                  </div>
                  <div className="min-w-0 rounded-xl bg-yard-sunken border border-yard-line px-3 py-2.5">
                    <p className="yard-eyebrow">Garantía</p>
                    <p className="mt-1 font-mono text-[12px] font-bold text-yard-ink truncate">
                      {selectedOrder.warrantyDays || 60} días
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 min-h-[48px] rounded-xl bg-yard-sunken border border-yard-line pl-3 pr-1">
                  <div className="min-w-0 flex-1">
                    <p className="yard-eyebrow">VIN</p>
                    <p className="font-mono text-[12px] font-bold text-yard-ink truncate">
                      {selectedOrder.vehicle?.vin || 'No registrado'}
                    </p>
                  </div>
                  {selectedOrder.vehicle?.vin && (
                    <button
                      type="button"
                      onClick={() => handleCopyVin(selectedOrder.vehicle?.vin)}
                      aria-label="Copiar VIN"
                      className="yard-icon-btn shrink-0"
                    >
                      <span aria-hidden="true" className="material-symbols-outlined text-[18px]">
                        {copiedField === 'vin' ? 'check' : 'content_copy'}
                      </span>
                    </button>
                  )}
                </div>

                {selectedOrder.productSpecs && (
                  <div className="pt-3 border-t border-yard-line space-y-1">
                    <p className="yard-eyebrow">Descripción técnica</p>
                    <p className="text-[11.5px] leading-relaxed text-yard-ink-soft whitespace-pre-line">
                      {selectedOrder.productSpecs}
                    </p>
                  </div>
                )}
              </section>

              {/* Zona destructiva, separada de la acción primaria */}
              {isSuperAdmin && selectedOrder.status !== 'cancelado' && (
                <button
                  type="button"
                  onClick={() => {
                    const toCancel = selectedOrder;
                    setSelectedOrderId(null);
                    setOrderToCancel(toCancel);
                    setIsCancelModalOpen(true);
                  }}
                  className="w-full min-h-[48px] rounded-xl border border-yard-line bg-yard-surface text-yard-danger-strong hover:bg-yard-raised font-mono font-bold text-[11px] flex items-center justify-center gap-1.5 active:scale-[0.99] transition-all cursor-pointer"
                >
                  <span aria-hidden="true" className="material-symbols-outlined text-[16px]">block</span>
                  <span>Cancelar orden</span>
                </button>
              )}
            </div>

            {/* Footer de acciones: la primaria ocupa su propia fila en todo tamaño */}
            <div className="border-t border-yard-line bg-yard-surface px-3 sm:px-4 pt-3 pb-3 safe-bottom-padded flex flex-wrap items-center gap-2 sm:justify-between">
              <button
                type="button"
                onClick={handleCloseDetail}
                className="yard-btn yard-btn--ghost flex-1 sm:flex-none px-3.5"
              >
                <span aria-hidden="true" className="material-symbols-outlined text-[18px]">arrow_back</span>
                <span>Volver</span>
              </button>

              {selectedOrder.status === 'pagado' && !selectedOrder.yardPieceReady && (
                selectedOrder.yardPieceUnavailable ? (
                  <button
                    type="button"
                    onClick={() => setOrderForUnavailableInfo(selectedOrder)}
                    title="Ver detalles de la alerta de no disponible"
                    className="yard-btn yard-btn--secondary flex-1 sm:flex-none px-3"
                  >
                    <span aria-hidden="true" className="material-symbols-outlined text-[17px]">warning</span>
                    <span>En subasta</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={markingReadyId === selectedOrder.id || markingUnavailableId === selectedOrder.id}
                    onClick={() => setOrderForUnavailable(selectedOrder)}
                    title="Reportar pieza no disponible en patio y activar búsqueda en subasta"
                    className="yard-btn yard-btn--secondary flex-1 sm:flex-none px-3"
                  >
                    <span aria-hidden="true" className="material-symbols-outlined text-[17px]">production_quantity_limits</span>
                    <span>No disponible</span>
                  </button>
                )
              )}

              {selectedOrder.status === 'pagado' && !selectedOrder.yardPieceReady && (
                <button
                  type="button"
                  disabled={markingReadyId === selectedOrder.id || markingUnavailableId === selectedOrder.id}
                  onClick={() => setOrderForReady(selectedOrder)}
                  className="yard-btn yard-btn--primary order-first w-full"
                >
                  <span aria-hidden="true" className="material-symbols-outlined text-[18px]">check_circle</span>
                  <span className="truncate">{markingReadyId === selectedOrder.id ? 'Marcando…' : 'Confirmar Pieza Lista en Patio'}</span>
                </button>
              )}

              {selectedOrder.status === 'pagado' && selectedOrder.yardPieceReady && (
                <>
                  <div className="order-first w-full min-h-[48px] px-3 rounded-[14px] bg-yard-success-soft border border-yard-success text-yard-success-strong font-mono font-bold text-[11px] flex items-center justify-center gap-1.5">
                    <span aria-hidden="true" className="material-symbols-outlined text-[18px]">notifications_active</span>
                    <span className="truncate">Pieza lista · Pendiente de retiro</span>
                  </div>
                  {isSuperAdmin && (
                    <button
                      type="button"
                      disabled={revertingYardReadyId === selectedOrder.id}
                      onClick={() => setOrderForRevert(selectedOrder)}
                      title="Revertir pieza lista y devolver a pendientes"
                      aria-label="Revertir pieza lista y devolver a pendientes"
                      className="yard-btn yard-btn--ghost flex-1 sm:flex-none px-3"
                    >
                      <span aria-hidden="true" className="material-symbols-outlined text-[17px]">undo</span>
                      <span>Revertir</span>
                    </button>
                  )}
                </>
              )}

              {selectedOrder.status === 'reclamo' && (
                selectedOrder.claimPieceReady ? (
                  <>
                    <div className="order-first w-full min-h-[48px] px-3 rounded-[14px] bg-yard-success-soft border border-yard-success text-yard-success-strong font-mono font-bold text-[11px] flex items-center justify-center gap-1.5">
                      <span aria-hidden="true" className="material-symbols-outlined text-[18px]">task_alt</span>
                      <span className="truncate">Pieza de cambio notificada</span>
                    </div>
                    {isSuperAdmin && (
                      <button
                        type="button"
                        disabled={revertingClaimReadyId === selectedOrder.id}
                        onClick={() => setOrderForClaimRevert(selectedOrder)}
                        title="Revertir aviso de pieza de cambio"
                        aria-label="Revertir aviso de pieza de cambio"
                        className="yard-btn yard-btn--ghost flex-1 sm:flex-none px-3"
                      >
                        <span aria-hidden="true" className="material-symbols-outlined text-[17px]">undo</span>
                        <span>Revertir</span>
                      </button>
                    )}
                  </>
                ) : (
                  <button
                    type="button"
                    disabled={markingClaimReadyId === selectedOrder.id}
                    onClick={() => setOrderForClaimReady(selectedOrder)}
                    className="yard-btn yard-btn--success order-first w-full"
                  >
                    <span aria-hidden="true" className="material-symbols-outlined text-[18px]">campaign</span>
                    <span className="truncate">{markingClaimReadyId === selectedOrder.id ? 'Notificando…' : 'Notificar Pieza de Cambio Lista'}</span>
                  </button>
                )
              )}
            </div>
          </div>
        </div>
      )}

      {/* Tab Bar Inferior (iOS / Android PWA style) */}
      <nav
        aria-label="Bandejas de patio"
        className="yard-nav fixed bottom-0 left-0 right-0 z-40 px-2 pt-1.5 safe-bottom-padded"
      >
        <div className="yard-nav-inner max-w-3xl mx-auto flex items-stretch gap-1">
          {YARD_TABS.map((tabId) => {
            const meta = YARD_TAB_META[tabId];
            const isActive = filterTab === tabId;
            const count = counts[tabId];
            return (
              <button
                key={tabId}
                type="button"
                onClick={() => selectFilterTab(tabId)}
                className="yard-tab"
                aria-current={isActive ? 'page' : undefined}
                aria-label={`${meta.label}, ${count} ${count === 1 ? 'orden' : 'órdenes'}`}
              >
                <span className="relative">
                  <span aria-hidden="true" className="material-symbols-outlined text-[22px]">{meta.icon}</span>
                  {count > 0 && (
                    <span className="yard-count absolute -top-1.5 -right-3">
                      {count > 99 ? '99+' : count}
                    </span>
                  )}
                </span>
                <span className="mt-0.5 tracking-tight">{meta.label}</span>
              </button>
            );
          })}
        </div>
      </nav>

      {/* Modal Confirmación Pieza No Disponible */}
      {orderForUnavailable && (
        <div
          className="yard-overlay fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/85 backdrop-blur-md"
          onClick={(event) => {
            if (event.target === event.currentTarget) closeTopOverlayRef.current();
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Activar búsqueda en subasta"
            className="w-full max-w-md bg-[#0d1424] border border-amber-500/30 rounded-2xl p-5 shadow-[0_15px_45px_rgba(0,0,0,0.7)] flex flex-col gap-4 animate-in fade-in zoom-in-95 duration-200"
          >
            {/* Header con botón cerrar */}
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400">
                  <span aria-hidden="true" className="material-symbols-outlined text-[22px]">gavel</span>
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white tracking-tight">Activar Búsqueda en Subasta</h3>
                  <p className="text-[11px] text-amber-400/90 font-mono">
                    #{orderForUnavailable.code} · {orderForUnavailable.mainPart}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setOrderForUnavailable(null);
                  setUnavailableReason('');
                }}
                className="w-11 h-11 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center transition-colors cursor-pointer"
                title="Cerrar"
                aria-label="Cerrar"
              >
                <span aria-hidden="true" className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>

            {/* Vehículo */}
            <div className="text-[11.5px] text-slate-300 font-mono -mt-1">
              Vehículo: <span className="text-white font-bold">{orderForUnavailable.vehicle?.year} {orderForUnavailable.vehicle?.make} {orderForUnavailable.vehicle?.model}</span>
            </div>

            {/* Aviso Operativo */}
            <div className="bg-slate-900/90 border border-slate-700/70 rounded-xl p-3 text-xs space-y-1.5 font-mono">
              <div className="flex items-center gap-1.5 text-amber-300 font-bold text-[11.5px]">
                <span aria-hidden="true" className="material-symbols-outlined text-[16px]">notification_important</span>
                <span>Pieza no disponible en patio físico</span>
              </div>
              <p className="text-[11px] text-slate-300 leading-relaxed">
                Se activará la <strong>búsqueda en subasta</strong> (Copart/IAAI) y se alertará de inmediato al <strong>Asesor</strong> y al <strong>Administrador</strong> para contactar al cliente (extensión de tiempo, cancelación o reembolso).
              </p>
            </div>

            {/* Campo Motivo */}
            <div className="space-y-1.5 font-mono">
              <label className="text-[11px] font-bold text-slate-300 flex items-center gap-1">
                <span aria-hidden="true" className="material-symbols-outlined text-[14px] text-amber-400">edit_note</span>
                Motivo / Observación de Patio:
              </label>
              <input
                type="text"
                value={unavailableReason}
                onChange={(e) => setUnavailableReason(e.target.value)}
                placeholder="Ej: No encontrada en anaqueles, pieza dañada..."
                className="w-full px-3 py-2.5 rounded-xl bg-slate-950 border border-slate-700 focus:border-amber-400 text-white text-xs placeholder:text-slate-500 focus:outline-none transition-colors"
              />
              <div className="flex flex-wrap gap-1.5 pt-1">
                {['No encontrada en patio', 'Pieza con daño o fisura', 'Vehículo no coincide'].map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setUnavailableReason(preset)}
                    className="text-[10.5px] min-h-[44px] px-3 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 cursor-pointer active:scale-95 transition-all"
                  >
                    {preset}
                  </button>
                ))}
              </div>
            </div>

            {/* Botones de acción */}
            <div className="flex items-center gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                disabled={markingUnavailableId === orderForUnavailable.id}
                onClick={() => {
                  setOrderForUnavailable(null);
                  setUnavailableReason('');
                }}
                className="flex-1 min-h-[48px] px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-mono font-bold text-xs transition-all cursor-pointer"
              >
                Volver
              </button>
              <button
                type="button"
                disabled={markingUnavailableId === orderForUnavailable.id}
                onClick={() => handleMarkYardUnavailable(orderForUnavailable, unavailableReason)}
                className="flex-1 min-h-[48px] px-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-mono font-black text-xs shadow-[0_0_15px_rgba(245,158,11,0.3)] transition-all cursor-pointer active:scale-95 flex items-center justify-center gap-1.5"
              >
                <span aria-hidden="true" className="material-symbols-outlined text-[16px]">campaign</span>
                <span>{markingUnavailableId === orderForUnavailable.id ? 'Notificando...' : 'Notificar Alerta'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Confirmación Pieza Lista en Patio */}
      {orderForReady && (
        <div
          className="yard-overlay fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/85 backdrop-blur-md"
          onClick={(event) => {
            if (event.target === event.currentTarget) closeTopOverlayRef.current();
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Confirmar pieza lista en patio"
            className="w-full max-w-md bg-[#0d1424] border border-amber-500/30 rounded-2xl p-5 shadow-[0_15px_45px_rgba(0,0,0,0.7)] flex flex-col gap-4 animate-in fade-in zoom-in-95 duration-200"
          >
            {/* Header con botón cerrar */}
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400">
                  <span aria-hidden="true" className="material-symbols-outlined text-[22px]">build_circle</span>
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white tracking-tight">¿Confirmar Pieza Lista?</h3>
                  <p className="text-[11px] text-amber-400/90 font-mono">
                    #{orderForReady.code} · {orderForReady.mainPart}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setOrderForReady(null)}
                className="w-11 h-11 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center transition-colors cursor-pointer"
                title="Cerrar"
                aria-label="Cerrar"
              >
                <span aria-hidden="true" className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>

            {/* Vehículo y Pallet */}
            <div className="space-y-1.5 text-[11.5px] font-mono">
              <div className="text-slate-300">
                Vehículo: <span className="text-white font-bold">{orderForReady.vehicle?.year} {orderForReady.vehicle?.make} {orderForReady.vehicle?.model}</span>
              </div>
              <div className="flex items-center gap-2 text-amber-300">
                <span className="text-slate-400">Ubicación / Pallet:</span>
                <span className="bg-amber-500/20 px-2 py-0.5 rounded text-white font-bold border border-amber-500/30">
                  {orderForReady.stockNumber ? orderForReady.stockNumber.toUpperCase() : 'PENDIENTE'}
                </span>
              </div>
            </div>

            {/* Alerta contextual si la pieza estaba en No Disponible */}
            {orderForReady.yardPieceUnavailable && (
              <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-2.5 text-xs font-mono text-amber-200 flex items-start gap-2">
                <span aria-hidden="true" className="material-symbols-outlined text-[16px] text-amber-400 flex-shrink-0 mt-0.5">info</span>
                <p className="text-[11px] leading-relaxed">
                  Esta pieza estaba reportada como <strong>No Disponible</strong>. Al confirmar, se marcará como localizada y lista en patio.
                </p>
              </div>
            )}

            {/* Aviso Operativo */}
            <div className="bg-slate-900/90 border border-slate-700/70 rounded-xl p-3 text-xs space-y-1 font-mono">
              <div className="flex items-center gap-1.5 text-emerald-400 font-bold text-[11.5px]">
                <span aria-hidden="true" className="material-symbols-outlined text-[16px]">verified</span>
                <span>Verificación de Patio Físico</span>
              </div>
              <p className="text-[11px] text-slate-300 leading-relaxed">
                Se notificará al sistema y a los asesores que la refacción fue retirada, verificada y está lista para despacho/entrega.
              </p>
            </div>

            {/* Botones de acción */}
            <div className="flex items-center gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                disabled={markingReadyId === orderForReady.id}
                onClick={() => setOrderForReady(null)}
                className="flex-1 min-h-[48px] px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-mono font-bold text-xs transition-all cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={markingReadyId === orderForReady.id}
                onClick={async () => {
                  const target = orderForReady;
                  setOrderForReady(null);
                  await handleMarkYardReady(target);
                }}
                className="flex-1 min-h-[48px] px-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-mono font-black text-xs shadow-[0_0_15px_rgba(245,158,11,0.3)] transition-all cursor-pointer active:scale-95 flex items-center justify-center gap-1.5"
              >
                <span aria-hidden="true" className="material-symbols-outlined text-[16px]">check_circle</span>
                <span>{markingReadyId === orderForReady.id ? 'Confirmando...' : 'Sí, Pieza Lista'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Confirmación Revertir Pieza Lista */}
      {orderForRevert && (
        <div
          className="yard-overlay fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/85 backdrop-blur-md"
          onClick={(event) => {
            if (event.target === event.currentTarget) closeTopOverlayRef.current();
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Revertir pieza lista"
            className="w-full max-w-md bg-[#0d1424] border border-amber-500/30 rounded-2xl p-5 shadow-[0_15px_45px_rgba(0,0,0,0.7)] flex flex-col gap-4 animate-in fade-in zoom-in-95 duration-200"
          >
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400">
                  <span aria-hidden="true" className="material-symbols-outlined text-[22px]">undo</span>
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white tracking-tight">¿Revertir Pieza Lista?</h3>
                  <p className="text-[11px] text-amber-400/90 font-mono">
                    #{orderForRevert.code} · {orderForRevert.mainPart}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setOrderForRevert(null)}
                className="w-11 h-11 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center transition-colors cursor-pointer"
                title="Cerrar"
                aria-label="Cerrar"
              >
                <span aria-hidden="true" className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>

            <div className="space-y-1.5 text-[11.5px] font-mono">
              <div className="text-slate-300">
                Vehículo: <span className="text-white font-bold">{orderForRevert.vehicle?.year} {orderForRevert.vehicle?.make} {orderForRevert.vehicle?.model}</span>
              </div>
              <div className="flex items-center gap-2 text-amber-300">
                <span className="text-slate-400">Ubicación / Pallet:</span>
                <span className="bg-amber-500/20 px-2 py-0.5 rounded text-white font-bold border border-amber-500/30">
                  {orderForRevert.stockNumber ? orderForRevert.stockNumber.toUpperCase() : 'PENDIENTE'}
                </span>
              </div>
            </div>

            <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 text-xs space-y-1 font-mono">
              <div className="flex items-center gap-1.5 text-amber-300 font-bold text-[11.5px]">
                <span aria-hidden="true" className="material-symbols-outlined text-[16px]">info</span>
                <span>Solo Administradores</span>
              </div>
              <p className="text-[11px] text-slate-300 leading-relaxed">
                La orden volverá a <strong>Pendientes</strong> para que la yarda la confirme de nuevo. No se restauran fotos que se hayan limpiado al confirmarla.
              </p>
            </div>

            <div className="flex items-center gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                disabled={revertingYardReadyId === orderForRevert.id}
                onClick={() => setOrderForRevert(null)}
                className="flex-1 min-h-[48px] px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-mono font-bold text-xs transition-all cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={revertingYardReadyId === orderForRevert.id}
                onClick={async () => {
                  const target = orderForRevert;
                  await handleRevertYardReady(target);
                }}
                className="flex-1 min-h-[48px] px-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-mono font-black text-xs shadow-[0_0_15px_rgba(245,158,11,0.3)] transition-all cursor-pointer active:scale-95 flex items-center justify-center gap-1.5"
              >
                <span aria-hidden="true" className="material-symbols-outlined text-[16px]">undo</span>
                <span>{revertingYardReadyId === orderForRevert.id ? 'Revirtiendo...' : 'Sí, Revertir'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Confirmación Pieza de Cambio Lista */}
      {orderForClaimReady && (
        <div
          className="yard-overlay fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/85 backdrop-blur-md"
          onClick={(event) => {
            if (event.target === event.currentTarget) closeTopOverlayRef.current();
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Notificar pieza de cambio lista"
            className="w-full max-w-md bg-[#0d1424] border border-emerald-500/30 rounded-2xl p-5 shadow-[0_15px_45px_rgba(0,0,0,0.7)] flex flex-col gap-4 animate-in fade-in zoom-in-95 duration-200"
          >
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
                  <span aria-hidden="true" className="material-symbols-outlined text-[22px]">campaign</span>
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white tracking-tight">¿Notificar Pieza de Cambio?</h3>
                  <p className="text-[11px] text-emerald-400/90 font-mono">
                    #{orderForClaimReady.code} · {orderForClaimReady.mainPart}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setOrderForClaimReady(null)}
                className="w-11 h-11 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center transition-colors cursor-pointer"
                title="Cerrar"
                aria-label="Cerrar"
              >
                <span aria-hidden="true" className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>

            <div className="space-y-1.5 text-[11.5px] font-mono">
              <div className="text-slate-300">
                Vehículo: <span className="text-white font-bold">{orderForClaimReady.vehicle?.year} {orderForClaimReady.vehicle?.make} {orderForClaimReady.vehicle?.model}</span>
              </div>
              <div className="flex items-center gap-2 text-emerald-300">
                <span className="text-slate-400">Ubicación / Pallet:</span>
                <span className="bg-emerald-500/20 px-2 py-0.5 rounded text-white font-bold border border-emerald-500/30">
                  {orderForClaimReady.stockNumber ? orderForClaimReady.stockNumber.toUpperCase() : 'PENDIENTE'}
                </span>
              </div>
            </div>

            <div className="bg-slate-900/90 border border-slate-700/70 rounded-xl p-3 text-xs space-y-1 font-mono">
              <div className="flex items-center gap-1.5 text-emerald-400 font-bold text-[11.5px]">
                <span aria-hidden="true" className="material-symbols-outlined text-[16px]">notifications_active</span>
                <span>Notificación a Asesores y Administradores</span>
              </div>
              <p className="text-[11px] text-slate-300 leading-relaxed">
                Se enviará un aviso de que la pieza de cambio está lista en patio para coordinar el cambio con el cliente. Esta acción no modifica el estado de la orden.
              </p>
            </div>

            <div className="flex items-center gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                disabled={markingClaimReadyId === orderForClaimReady.id}
                onClick={() => setOrderForClaimReady(null)}
                className="flex-1 min-h-[48px] px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-mono font-bold text-xs transition-all cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={markingClaimReadyId === orderForClaimReady.id}
                onClick={async () => {
                  const target = orderForClaimReady;
                  await handleNotifyClaimPieceReady(target);
                }}
                className="flex-1 min-h-[48px] px-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-mono font-black text-xs shadow-[0_0_15px_rgba(16,185,129,0.3)] transition-all cursor-pointer active:scale-95 flex items-center justify-center gap-1.5"
              >
                <span aria-hidden="true" className="material-symbols-outlined text-[16px]">send</span>
                <span>{markingClaimReadyId === orderForClaimReady.id ? 'Notificando...' : 'Sí, Notificar'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Confirmación Revertir Aviso de Pieza de Cambio */}
      {orderForClaimRevert && (
        <div
          className="yard-overlay fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/85 backdrop-blur-md"
          onClick={(event) => {
            if (event.target === event.currentTarget) closeTopOverlayRef.current();
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Revertir aviso de pieza de cambio"
            className="w-full max-w-md bg-[#0d1424] border border-amber-500/30 rounded-2xl p-5 shadow-[0_15px_45px_rgba(0,0,0,0.7)] flex flex-col gap-4 animate-in fade-in zoom-in-95 duration-200"
          >
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400">
                  <span aria-hidden="true" className="material-symbols-outlined text-[22px]">undo</span>
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white tracking-tight">¿Revertir Aviso de Cambio?</h3>
                  <p className="text-[11px] text-amber-400/90 font-mono">
                    #{orderForClaimRevert.code} · {orderForClaimRevert.mainPart}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setOrderForClaimRevert(null)}
                className="w-11 h-11 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center transition-colors cursor-pointer"
                title="Cerrar"
                aria-label="Cerrar"
              >
                <span aria-hidden="true" className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>

            <div className="space-y-1.5 text-[11.5px] font-mono">
              <div className="text-slate-300">
                Vehículo: <span className="text-white font-bold">{orderForClaimRevert.vehicle?.year} {orderForClaimRevert.vehicle?.make} {orderForClaimRevert.vehicle?.model}</span>
              </div>
              <div className="flex items-center gap-2 text-amber-300">
                <span className="text-slate-400">Ubicación / Pallet:</span>
                <span className="bg-amber-500/20 px-2 py-0.5 rounded text-white font-bold border border-amber-500/30">
                  {orderForClaimRevert.stockNumber ? orderForClaimRevert.stockNumber.toUpperCase() : 'PENDIENTE'}
                </span>
              </div>
            </div>

            <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 text-xs space-y-1 font-mono">
              <div className="flex items-center gap-1.5 text-amber-300 font-bold text-[11.5px]">
                <span aria-hidden="true" className="material-symbols-outlined text-[16px]">info</span>
                <span>Solo Administradores</span>
              </div>
              <p className="text-[11px] text-slate-300 leading-relaxed">
                La pieza volverá a <strong>pendiente de cambio</strong> y podrás volver a notificarla. Los mensajes de WhatsApp ya encolados no se pueden recuperar.
              </p>
            </div>

            <div className="flex items-center gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                disabled={revertingClaimReadyId === orderForClaimRevert.id}
                onClick={() => setOrderForClaimRevert(null)}
                className="flex-1 min-h-[48px] px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-mono font-bold text-xs transition-all cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={revertingClaimReadyId === orderForClaimRevert.id}
                onClick={async () => {
                  const target = orderForClaimRevert;
                  await handleRevertClaimReady(target);
                }}
                className="flex-1 min-h-[48px] px-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-mono font-black text-xs shadow-[0_0_15px_rgba(245,158,11,0.3)] transition-all cursor-pointer active:scale-95 flex items-center justify-center gap-1.5"
              >
                <span aria-hidden="true" className="material-symbols-outlined text-[16px]">undo</span>
                <span>{revertingClaimReadyId === orderForClaimRevert.id ? 'Revirtiendo...' : 'Sí, Revertir'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Información Pieza No Disponible */}
      {orderForUnavailableInfo && (
        <div
          className="yard-overlay fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/85 backdrop-blur-md"
          onClick={(event) => {
            if (event.target === event.currentTarget) closeTopOverlayRef.current();
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Información de pieza no disponible"
            className="w-full max-w-md bg-[#0d1424] border border-amber-500/40 rounded-2xl p-5 shadow-[0_15px_45px_rgba(0,0,0,0.7)] flex flex-col gap-4 animate-in fade-in zoom-in-95 duration-200"
          >
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400">
                  <span aria-hidden="true" className="material-symbols-outlined text-[22px]">warning</span>
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white tracking-tight">Pieza Reportada No Disponible</h3>
                  <p className="text-[11px] text-amber-400/90 font-mono">
                    #{orderForUnavailableInfo.code} · {orderForUnavailableInfo.mainPart}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setOrderForUnavailableInfo(null)}
                className="w-11 h-11 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center transition-colors cursor-pointer"
                title="Cerrar"
                aria-label="Cerrar"
              >
                <span aria-hidden="true" className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>

            <div className="space-y-2 text-xs font-mono">
              <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-3 space-y-1.5">
                <div className="text-slate-400 text-[10px] uppercase font-bold">Estado actual:</div>
                <div className="text-amber-300 font-bold flex items-center gap-1.5">
                  <span aria-hidden="true" className="material-symbols-outlined text-[16px]">gavel</span>
                  <span>Búsqueda en subasta activada (Copart / IAAI)</span>
                </div>
                <div className="text-slate-300 text-[11px] pt-1">
                  <span className="text-slate-500">Motivo reportado: </span>
                  <span className="text-white italic">{orderForUnavailableInfo.yardPieceUnavailableReason || 'Pieza no encontrada en inventario físico'}</span>
                </div>
                {orderForUnavailableInfo.yardPieceUnavailableAt && (
                  <div className="text-slate-500 text-[10px]">
                    Reportado el {new Date(orderForUnavailableInfo.yardPieceUnavailableAt).toLocaleString('es-ES')}
                  </div>
                )}
              </div>

              <p className="text-[11px] text-slate-400 leading-relaxed px-1">
                El asesor y el administrador fueron notificados. Si la pieza es localizada posteriormente en patio físico, puedes presionar <strong>«Confirmar Pieza Lista en Patio»</strong> para restablecerla.
              </p>
            </div>

            <div className="pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setOrderForUnavailableInfo(null)}
                className="w-full min-h-[48px] px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-mono font-bold text-xs transition-all cursor-pointer"
              >
                Entendido
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Cancel Order Modal */}
      {isSuperAdmin && isCancelModalOpen && orderToCancel && (
        <CancelOrderModal
          order={orderToCancel}
          isOpen={isCancelModalOpen}
          isSuperAdmin={isSuperAdmin}
          onClose={() => {
            setIsCancelModalOpen(false);
            setOrderToCancel(null);
          }}
          onOrderCancelled={async (updatedOrder) => {
            if (onUpdateOrder) {
              await onUpdateOrder(updatedOrder);
            }
          }}
          onToast={showToast}
        />
      )}

      {/* Compatibility & Reference Images Modal */}
      {isSuperAdmin && isCompatibilityModalOpen && orderForCompatibility && (
        <YardCompatibilityModal
          order={orderForCompatibility}
          isOpen={isCompatibilityModalOpen}
          onClose={() => {
            setIsCompatibilityModalOpen(false);
            setOrderForCompatibility(null);
          }}
          onSaved={(newCompat) => handleCompatibilitySaved(orderForCompatibility.id, newCompat)}
          onToast={showToast}
          registerCloseRequest={registerCompatibilityCloseRequest}
        />
      )}
    </div>
  );
};
