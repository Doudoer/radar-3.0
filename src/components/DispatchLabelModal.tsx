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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-xl animate-fade-in">
      <div className="bg-[#070c18]/95 backdrop-blur-2xl border border-cyan-500/30 rounded-3xl w-full max-w-lg shadow-[0_20px_60px_rgba(0,0,0,0.85)] flex flex-col text-slate-100 relative overflow-hidden">
        {/* Laser Hairline */}
        <div className="cyber-laser-bar absolute top-0 left-0 right-0 z-20" />

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-cyan-500/20 bg-[#0a1022]/80 backdrop-blur-md">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
              <span className="material-symbols-outlined text-[18px]">qr_code_2</span>
            </div>
            <div>
              <h3 className="font-bold text-sm sm:text-base text-slate-100">Etiqueta Térmica de Despacho</h3>
              <p className="text-[11px] text-cyan-400 font-mono">Formato estándar 4x6 pulg</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handlePrint}
              className="px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 font-bold text-xs flex items-center gap-1.5 cursor-pointer shadow-[0_0_12px_rgba(6,182,212,0.35)] transition-all active:scale-95"
            >
              <span className="material-symbols-outlined text-[16px]">print</span>
              <span>Imprimir 4x6</span>
            </button>
            <button
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 cursor-pointer transition-colors"
            >
              <span className="material-symbols-outlined text-[20px]">close</span>
            </button>
          </div>
        </div>

        {/* 4x6 Thermal Label Container */}
        <div className="p-6 flex justify-center bg-[#050914]">
          <div className="w-[360px] bg-white text-slate-900 p-5 rounded-lg border-2 border-black flex flex-col gap-3 font-sans shadow-2xl">
            {/* Top Bar */}
            <div className="flex justify-between items-center border-b-2 border-black pb-2">
              <span className="font-black text-lg tracking-tight text-slate-950">RADAR LOGISTICS</span>
              <span className="font-mono font-bold text-xs bg-black text-white px-2 py-0.5 rounded">
                {order.deliveryType === 'envio_domicilio' ? 'ENVÍO EXPRESS' : 'RETIRO TIENDA'}
              </span>
            </div>

            {/* Order Code & Barcode Simulation */}
            <div className="flex flex-col items-center justify-center py-2 border-b-2 border-black">
              <div className="flex items-center gap-0.5 tracking-tighter text-3xl font-mono scale-y-125 my-1 select-none text-slate-950">
                ||| | |||| | || |||| | ||| |||| | |||
              </div>
              <span className="font-mono font-black text-xl tracking-wider text-slate-950">{order.code}</span>
              <span className="text-[10px] font-mono text-slate-600 font-bold">STOCK #{order.stockNumber || 'STK-2026-098'}</span>
            </div>

            {/* Recipient info */}
            <div className="text-xs border-b-2 border-black pb-3">
              <span className="text-[10px] font-black uppercase text-slate-500 block">DESTINATARIO:</span>
              <p className="font-black text-sm text-slate-900">{order.customer.name}</p>
              {order.customer.company && <p className="font-semibold text-slate-700">{order.customer.company}</p>}
              <p className="text-slate-800 font-mono">Tel: {order.customer.phone}</p>
              <p className="text-slate-800 mt-1 font-medium">
                {order.customer.shippingAddress || order.customer.location}
              </p>
            </div>

            {/* Vehicle & Item details */}
            <div className="text-xs border-b-2 border-black pb-2">
              <span className="text-[10px] font-black uppercase text-slate-500 block">DETALLE DE REFACCIÓN:</span>
              <p className="font-black text-slate-900">{order.mainPart}</p>
              <p className="text-[11px] text-slate-700 font-medium">
                Vehículo: {order.vehicle.year} {order.vehicle.make} {order.vehicle.model}
              </p>
              <p className="font-mono text-[10px] text-slate-600">VIN: {order.vehicle.vin}</p>
            </div>

            {/* Bottom Status & Core Notice */}
            <div className="flex justify-between items-center text-[10px] pt-1">
              <div>
                <span className="font-bold block text-slate-900">GARANTÍA: {order.warrantyDays || 60} DÍAS</span>
                <span className="text-slate-600">Asesor: {order.advisor}</span>
              </div>
              <div className="text-right">
                <span className="font-mono font-bold text-xs block text-slate-900">
                  {order.coreFee && order.coreFee > 0 ? `CORE: $${order.coreFee.toFixed(2)}` : 'SIN CORE'}
                </span>
                <span className="text-slate-500 font-mono text-[9px]">RADAR-3.0-CYBER</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
