import React from 'react';
import { Order } from '../types';

interface DispatchLabelModalProps {
  isOpen: boolean;
  onClose: () => void;
  order: Order;
}

export const DispatchLabelModal: React.FC<DispatchLabelModalProps> = ({
  isOpen,
  onClose,
  order,
}) => {
  if (!isOpen) return null;

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-sm animate-fade-in">
      <div className="bg-[#0f172a] border border-[#334155] rounded-2xl w-full max-w-lg shadow-2xl flex flex-col text-[#f8fafc]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#334155] bg-[#0b1329] rounded-t-2xl">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[#388bfd]">qr_code_2</span>
            <h3 className="font-bold text-base">Etiqueta Térmica de Despacho (4x6 pulg)</h3>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handlePrint}
              className="px-3 py-1.5 rounded-lg bg-[#388bfd] hover:bg-[#2563eb] text-[#0a1120] font-bold text-xs flex items-center gap-1.5 cursor-pointer shadow"
            >
              <span className="material-symbols-outlined text-[16px]">print</span>
              <span>Imprimir 4x6</span>
            </button>
            <button
              onClick={onClose}
              className="p-1 text-[#94a3b8] hover:text-[#f8fafc] rounded-lg hover:bg-[#1e293b] cursor-pointer"
            >
              <span className="material-symbols-outlined text-[20px]">close</span>
            </button>
          </div>
        </div>

        {/* 4x6 Thermal Label Container */}
        <div className="p-6 flex justify-center bg-slate-900">
          <div className="w-[360px] bg-white text-slate-900 p-5 rounded-lg border-2 border-black flex flex-col gap-3 font-sans shadow-xl">
            {/* Top Bar */}
            <div className="flex justify-between items-center border-b-2 border-black pb-2">
              <span className="font-black text-lg tracking-tight">RADAR LOGISTICS</span>
              <span className="font-mono font-bold text-xs bg-black text-white px-2 py-0.5 rounded">
                {order.deliveryType === 'envio_domicilio' ? 'ENVÍO EXPRESS' : 'RETIRO TIENDA'}
              </span>
            </div>

            {/* Order Code & Barcode Simulation */}
            <div className="flex flex-col items-center justify-center py-2 border-b-2 border-black">
              <div className="flex items-center gap-0.5 tracking-tighter text-3xl font-mono scale-y-125 my-1 select-none">
                ||| | |||| | || |||| | ||| |||| | |||
              </div>
              <span className="font-mono font-black text-xl tracking-wider">{order.code}</span>
              <span className="text-[10px] font-mono text-slate-600">STOCK #{order.stockNumber || 'STK-2026-098'}</span>
            </div>

            {/* Recipient info */}
            <div className="text-xs border-b-2 border-black pb-3">
              <span className="text-[10px] font-black uppercase text-slate-500 block">DESTINATARIO:</span>
              <p className="font-black text-sm text-slate-900">{order.customer.name}</p>
              {order.customer.company && <p className="font-semibold text-slate-700">{order.customer.company}</p>}
              <p className="text-slate-800">Tel: {order.customer.phone}</p>
              <p className="text-slate-800 mt-1 font-medium">
                {order.customer.shippingAddress || order.customer.location}
              </p>
            </div>

            {/* Vehicle & Item details */}
            <div className="text-xs border-b-2 border-black pb-2">
              <span className="text-[10px] font-black uppercase text-slate-500 block">DETALLE DE REFACCIÓN:</span>
              <p className="font-black text-slate-900">{order.mainPart}</p>
              <p className="text-[11px] text-slate-700">
                Vehículo: {order.vehicle.year} {order.vehicle.make} {order.vehicle.model}
              </p>
              <p className="font-mono text-[10px] text-slate-600">VIN: {order.vehicle.vin}</p>
            </div>

            {/* Bottom Status & Core Notice */}
            <div className="flex justify-between items-center text-[10px] pt-1">
              <div>
                <span className="font-bold block">GARANTÍA: {order.warrantyDays || 60} DÍAS</span>
                <span className="text-slate-600">Asesor: {order.advisor}</span>
              </div>
              <div className="text-right">
                <span className="font-mono font-bold text-xs block">
                  {order.coreFee && order.coreFee > 0 ? `CORE: $${order.coreFee.toFixed(2)}` : 'SIN CORE'}
                </span>
                <span className="text-slate-500">RADAR-SYSTEM-V2</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
