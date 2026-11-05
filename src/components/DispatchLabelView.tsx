import React, { useEffect, useState } from 'react';
import { Order } from '../types';
import QRCode from 'qrcode';

export const OrderQr: React.FC<{ order: Order }> = ({ order }) => {
  const [image, setImage] = useState('');
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    setImage('');
    setFailed(false);
    QRCode.toDataURL(JSON.stringify({ orderId: order.id, code: order.code }), {
      errorCorrectionLevel: 'M', width: 160, margin: 2,
    }).then((url) => { if (active) setImage(url); })
      .catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [order.id, order.code]);
  return image ? <img src={image} alt={`QR orden ${order.code}`} width={160} height={160} /> :
    <span className="text-xs">{failed ? 'QR no disponible' : 'Generando QR…'}</span>;
};

interface DispatchLabelViewProps {
  order: Order;
  onBack: () => void;
}

export const DispatchLabelView: React.FC<DispatchLabelViewProps> = ({ order, onBack }) => {
  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="radar-view horizon-view horizon-document-view text-[#dfe2ef] pb-10 space-y-6 animate-fade-in">
      {/* Top Header Card */}
      <div className="horizon-view-header">

        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3.5">
            <button
              type="button"
              onClick={onBack}
              className="mt-1 rounded-xl p-2.5 bg-[#040814] border border-cyan-500/30 text-cyan-400 hover:text-white hover:bg-cyan-500/20 transition-all shadow-[0_0_12px_rgba(6,182,212,0.2)] cursor-pointer active:scale-95"
              title="Volver al detalle de la orden"
            >
              <span className="material-symbols-outlined text-[22px]">arrow_back</span>
            </button>
            <div>
              <div className="flex flex-wrap items-center gap-2.5">
                <h1 className="text-xl md:text-2xl font-black text-white tracking-tight">
                  Rótulo Térmico de Despacho (4x6)
                </h1>
                <span className="rounded-lg border border-cyan-500/40 bg-cyan-950/50 px-2.5 py-0.5 font-mono text-xs font-bold text-cyan-300 shadow-[0_0_8px_rgba(6,182,212,0.3)]">
                  #{order.code}
                </span>
                <span className="px-2.5 py-0.5 rounded-full text-xs font-bold font-mono border border-cyan-500/40 bg-cyan-500/10 text-cyan-300">
                  Formato Térmico
                </span>
              </div>
              <p className="mt-1 text-xs text-slate-400 flex flex-wrap items-center gap-2">
                <span>Destinatario: <strong className="text-cyan-200">{order.customer.name}</strong></span>
                <span>•</span>
                <span>Modalidad: <strong className="text-slate-300">{order.deliveryType === 'envio_domicilio' ? 'Envío Domicilio' : 'Retiro Tienda'}</strong></span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5 pl-12 sm:pl-0">
            <button
              type="button"
              onClick={handlePrint}
              className="px-4 py-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 font-black text-xs flex items-center gap-1.5 cursor-pointer shadow-[0_0_15px_rgba(6,182,212,0.35)] transition-all active:scale-95"
            >
              <span className="material-symbols-outlined text-[18px]">print</span>
              <span>Imprimir Rótulo 4x6</span>
            </button>
            <button
              type="button"
              onClick={onBack}
              className="cyber-btn-secondary px-4 py-2 text-xs font-bold flex items-center gap-1.5"
            >
              <span className="material-symbols-outlined text-[16px]">arrow_back</span>
              <span>Volver a la Orden</span>
            </button>
          </div>
        </div>
      </div>

      {/* 4x6 Thermal Label Container */}
      <div className="flex justify-center">
        <div className="w-[380px] bg-white text-slate-950 p-6 rounded-2xl border-2 border-slate-950 flex flex-col gap-3 font-sans shadow-2xl">
          {/* Top Bar */}
          <div className="flex justify-between items-center border-b-2 border-black pb-2">
            <span className="font-black text-lg tracking-tight text-slate-950">Empresa: Sin registrar</span>
            <span className="font-mono font-bold text-xs bg-black text-white px-2.5 py-0.5 rounded">
              {order.deliveryType === 'envio_domicilio' ? 'ENVÍO EXPRESS' : 'RETIRO TIENDA'}
            </span>
          </div>

          {/* QR encodes the actual order identifier, not a simulated barcode. */}
          <div className="flex flex-col items-center justify-center py-3 border-b-2 border-black">
            <OrderQr order={order} />
            <span className="font-mono font-black text-2xl tracking-wider text-slate-950">{order.code}</span>
            <span className="text-[11px] font-mono text-slate-600 font-bold">STOCK: {order.stockNumber || 'Sin registrar'}</span>
          </div>

          {/* Recipient info */}
          <div className="text-xs border-b-2 border-black pb-3">
            <span className="text-[10px] font-black uppercase text-slate-500 block">DESTINATARIO:</span>
            <p className="font-black text-sm text-slate-900">{order.customer.name}</p>
            {order.customer.company && <p className="font-semibold text-slate-700">{order.customer.company}</p>}
            <p className="text-slate-800 font-mono">Tel: {order.customer.phone}</p>
            <p className="text-slate-800 mt-1 font-medium">
              {order.customer.shippingAddress || order.customer.address_shipping || order.customer.location || 'Sin registrar'}
            </p>
          </div>

          {/* Vehicle & Item details */}
          <div className="text-xs border-b-2 border-black pb-2">
            <span className="text-[10px] font-black uppercase text-slate-500 block">DETALLE DE REFACCIÓN:</span>
            <p className="font-black text-slate-900">{order.mainPart}</p>
            <p className="text-[11px] text-slate-700 font-medium">
              Vehículo: {order.vehicle.year} {order.vehicle.make} {order.vehicle.model}
            </p>
            <p className="font-mono text-[10px] text-slate-600">VIN: {order.vehicle.vin || 'N/A'}</p>
          </div>

          {/* Bottom Status & Core Notice */}
          <div className="flex justify-between items-center text-[10px] pt-1">
            <div>
              <span className="font-bold block text-slate-900">GARANTÍA: {order.warrantyDays == null ? 'Sin registrar' : `${order.warrantyDays} DÍAS`}</span>
              <span className="text-slate-600">Asesor: {order.advisor}</span>
            </div>
            <div className="text-right font-mono font-bold text-slate-900">
              Orden: {order.code}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
