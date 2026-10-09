import { describe, it, expect } from 'vitest';
import {
  DEFAULT_NOTIFICATION_CHANNELS,
  NotificationChannelKey,
} from '../src/integrations/wasender/notificationTypes';
import { formatWasenderPhone } from '../src/integrations/wasender/client';
import {
  formatNuevaVentaMessage,
  formatBusquedaSubastasMessage,
  formatNuevoReclamoMessage,
  formatSeguimientoReclamoMessage,
  formatRespaldoAutomaticoMessage,
  formatListaReclamosMessage,
  formatOrdenCanceladaMessage,
  formatSolicitudReembolsoMessage,
  formatCambioEstatusMessage,
} from '../src/integrations/wasender/notificationTemplates';

describe('Wasender WhatsApp Notification Routing Rules', () => {
  it('should define all 10 business channels with correct defaults', () => {
    const keys = DEFAULT_NOTIFICATION_CHANNELS.map((ch) => ch.key);
    expect(keys).toContain('NUEVA_VENTA');
    expect(keys).toContain('BUSQUEDA_SUBASTAS');
    expect(keys).toContain('NUEVO_RECLAMO');
    expect(keys).toContain('SEGUIMIENTO_RECLAMO');
    expect(keys).toContain('RESPALDO_AUTOMATICO');
    expect(keys).toContain('LISTA_RECLAMOS');
    expect(keys).toContain('ORDEN_CANCELADA');
    expect(keys).toContain('SOLICITUD_REEMBOLSO');
    expect(keys).toContain('CAMBIO_ESTATUS');
    expect(keys).toContain('ALERTA_SEGURIDAD');
    expect(DEFAULT_NOTIFICATION_CHANNELS.length).toBe(10);
  });

  it('should enforce superadmin_only target type for security-critical channels', () => {
    const refund = DEFAULT_NOTIFICATION_CHANNELS.find((ch) => ch.key === 'SOLICITUD_REEMBOLSO');
    const cancelled = DEFAULT_NOTIFICATION_CHANNELS.find((ch) => ch.key === 'ORDEN_CANCELADA');
    const backup = DEFAULT_NOTIFICATION_CHANNELS.find((ch) => ch.key === 'RESPALDO_AUTOMATICO');
    const auctions = DEFAULT_NOTIFICATION_CHANNELS.find((ch) => ch.key === 'BUSQUEDA_SUBASTAS');
    const securityAlert = DEFAULT_NOTIFICATION_CHANNELS.find((ch) => ch.key === 'ALERTA_SEGURIDAD');

    expect(refund?.targetType).toBe('superadmin_only');
    expect(cancelled?.targetType).toBe('superadmin_only');
    expect(backup?.targetType).toBe('superadmin_only');
    expect(auctions?.targetType).toBe('superadmin_only');
    expect(securityAlert?.targetType).toBe('superadmin_only');
  });

  it('should enforce creator_dynamic target type for CAMBIO_ESTATUS', () => {
    const statusChange = DEFAULT_NOTIFICATION_CHANNELS.find((ch) => ch.key === 'CAMBIO_ESTATUS');
    expect(statusChange?.targetType).toBe('creator_dynamic');
    expect(statusChange?.triggerNotes).toContain('Listo para Retiro');
  });

  it('should format Venezuelan and international phone numbers correctly', () => {
    expect(formatWasenderPhone('04127307933')).toBe('+584127307933');
    expect(formatWasenderPhone('4127307933')).toBe('+584127307933');
    expect(formatWasenderPhone('+58 412-730-7933')).toBe('+584127307933');
    expect(formatWasenderPhone('13055551234')).toBe('+13055551234');
    expect(formatWasenderPhone('+1 (305) 555-1234')).toBe('+13055551234');
  });

  it('validates CAMBIO_ESTATUS condition logic for ready states', () => {
    const isReadyForPickupOrDelivery = (status: string) => {
      const st = (status || '').toLowerCase().trim();
      return (
        st.includes('retiro') ||
        st.includes('envio') ||
        st.includes('despacho') ||
        st === 'listo para retiro' ||
        st === 'listo para despacho' ||
        st === 'listo para envio'
      );
    };

    expect(isReadyForPickupOrDelivery('Listo para Retiro')).toBe(true);
    expect(isReadyForPickupOrDelivery('listo para retiro')).toBe(true);
    expect(isReadyForPickupOrDelivery('Listo para Despacho')).toBe(true);
    expect(isReadyForPickupOrDelivery('Listo para Envio')).toBe(true);

    expect(isReadyForPickupOrDelivery('Cotización')).toBe(false);
    expect(isReadyForPickupOrDelivery('Pagado')).toBe(false);
    expect(isReadyForPickupOrDelivery('En Tránsito')).toBe(false);
    expect(isReadyForPickupOrDelivery('Cancelado')).toBe(false);
  });

  it('validates formatting of all 9 notification templates', () => {

    const nuevaVenta = formatNuevaVentaMessage({
      orderCode: 'ORD-524932',
      customerName: 'Ricardo Santiago',
      customerPhone: '+19103053788',
      vehicleYear: 2016,
      vehicleMake: 'NISSAN',
      vehicleModel: 'Sentra',
      vin: '3N1AB7AP6GY311454',
      mainPart: 'Transmission',
      productSpecs: 'AT, (CVT), (1.8L)',
      totalPrice: 1500,
      downPayment: 200,
      deliveryType: 'retiro_tienda',
    });
    expect(nuevaVenta).toContain('🚀 *NUEVA VENTA* | `#ORD-524932`');
    expect(nuevaVenta).toContain('Ricardo Santiago (+19103053788)');
    expect(nuevaVenta).toContain('3N1AB7AP6GY311454');
    expect(nuevaVenta).toContain('Retiro en Tienda / Local');

    const subastas = formatBusquedaSubastasMessage({
      customerName: "G' Black Tires",
      saleDate: '6/8/2026',
      totalPrice: 2700,
      vehicleYear: 2015,
      vehicleMake: 'RAM',
      vehicleModel: '1500',
      mainPart: 'Engine',
      vin: '1C6RR7GG3FS524370',
      description: '3.6L (VIN G, 8th digit), w/o automatic engine stop and start',
      auctionLinks: [
        { house: 'Copart', date: '28/9/2026', url: 'https://www.copart.com/lot/69789446' },
      ],
    });
    expect(subastas).toContain('🚗 *BÚSQUEDA SUBASTA*🚗');
    expect(subastas).toContain("G' Black Tires");
    expect(subastas).toContain('Copart');

    const nuevoReclamo = formatNuevoReclamoMessage({
      orderCode: 'ORD-900283',
      customerName: 'Dan Diggf',
      customerPhone: '9197535676',
      vehicleYear: 2012,
      vehicleMake: 'CHEVROLET',
      vehicleModel: 'Traverse',
      vin: '1GNKVJEDXCJ12534',
      mainPart: 'Transmission',
      productSpecs: 'AT, AWD',
      claimReason: 'Falla interna comprobada.',
    });
    expect(nuevoReclamo).toContain('⚠️ *NUEVO RECLAMO* | `#ORD-900283`');
    expect(nuevoReclamo).toContain('Dan Diggf (9197535676)');

    const segReclamo = formatSeguimientoReclamoMessage({
      orderCode: 'ORD-044700',
      callNumber: 1,
      customerName: 'Casimiro Figueroa',
      customerPhone: '9192626168',
      vehicleYear: 2005,
      vehicleMake: 'CHEVROLET',
      vehicleModel: 'Silverado',
      mainPart: 'Transmission',
      productSpecs: 'AT, 5.3L, 4x4,',
      originalClaimReason: 'Reclamo original',
      callNotes: 'Detalle de la llamada',
      attendantName: 'Favio Andrade',
    });
    expect(segReclamo).toContain('🚨 *SEGUIMIENTO RECLAMO* | `#ORD-044700` *(Llamada #1)*');
    expect(segReclamo).toContain('Favio Andrade');

    const respaldo = formatRespaldoAutomaticoMessage({
      downloadUrl: 'https://radar-rsy.site/api/uploads/backups/backup_sample.sql.gz',
    });
    expect(respaldo).toContain('*Respaldo Automático Diario*');
    expect(respaldo).toContain('https://radar-rsy.site/api/uploads/backups/backup_sample.sql.gz');

    const lista = formatListaReclamosMessage({
      dateFormatted: '12/09/2026',
      claims: [
        {
          index: 1,
          orderCode: 'ORD-869013',
          customerName: 'Javier Cedillos',
          customerPhone: '9802307137',
          vehicleYear: 2014,
          vehicleMake: 'CHEVROLET',
          vehicleModel: 'Silverado',
          mainPart: 'Transmission',
          productSpecs: 'AT, 4x4, 5.3L, w/o tow package',
          claimReason: 'Falla convertidora',
          daysElapsed: 9,
          callCount: 0,
        },
      ],
    });
    expect(lista).toContain('📋 *REPORTE DIARIO DE RECLAMOS PENDIENTES*');
    expect(lista).toContain('Javier Cedillos');

    const cancelada = formatOrdenCanceladaMessage({
      orderCode: 'ORD-690538',
      customerName: "Luca's Auto",
      vehicleYear: 2013,
      vehicleMake: 'NISSAN',
      vehicleModel: 'Rogue',
      mainPart: 'Transmission',
      productSpecs: 'AT, (CVT), 4x2 (FWD), w/o tow package',
      refundAmount: 950.0,
    });
    expect(cancelada).toContain('Tipo: Orden cancelada - Reembolso pendiente');
    expect(cancelada).toContain('Reembolso pendiente para orden ORD-690538');

    const reembolso = formatSolicitudReembolsoMessage({
      orderCode: 'ORD-10398',
      beneficiaryName: 'Taller Mecánico San Rafael',
      amount: 320.0,
      reason: 'Pieza no compatible',
    });
    expect(reembolso).toContain('💸 *RADAR V3 • Solicitud de Reembolso*');
    expect(reembolso).toContain('$320.00');

    const estatus = formatCambioEstatusMessage({
      orderCode: 'ORD-358924',
      vehicleYear: 2008,
      vehicleMake: 'FORD',
      vehicleModel: 'Explorer Sport Trac',
      mainPart: 'Transmission',
      customerName: 'Shadetree  Auto',
      customerPhone: '4345751490',
      newStatus: 'Listo para Retiro',
      advisorName: 'Favio Andrade',
    });
    expect(estatus).toContain('🔔 *ACTUALIZACIÓN DE ORDEN / PIEZA LISTA*');
    expect(estatus).toContain('Shadetree  Auto (4345751490)');
    expect(estatus).toContain('Favio Andrade');
  });
});
