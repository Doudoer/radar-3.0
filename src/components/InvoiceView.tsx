import React from 'react';
import { Order } from '../types';

interface InvoiceViewProps {
  order: Order;
  onBack: () => void;
}

export const InvoiceView: React.FC<InvoiceViewProps> = ({ order, onBack }) => {
  const partPrice = order.financials.partPrice ?? order.financials.baseMSRP ?? 1000;
  const downPayment = order.financials.downPayment ?? order.financials.advancePayment ?? 0;
  const deliveryFee = order.financials.deliveryFee ?? 0;
  const coreFee = order.financials.coreFee ?? 0;
  const grossSubtotal = partPrice + deliveryFee + coreFee;
  const totalPayable = Math.max(0, grossSubtotal - downPayment);

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="radar-view text-[#dfe2ef] pb-10 space-y-6 animate-fade-in">
      {/* Top Header Card */}
      <div className="relative rounded-3xl bg-[#070c18]/90 backdrop-blur-2xl border border-cyan-500/30 p-5 md:p-6 shadow-[0_10px_30px_rgba(0,0,0,0.6)] overflow-hidden">
        <div className="absolute top-0 inset-x-0 h-[2.5px] bg-gradient-to-r from-transparent via-cyan-400 to-blue-500 shadow-[0_0_15px_#22d3ee]" />

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
                  Comprobante Oficial / Invoice
                </h1>
                <span className="rounded-lg border border-cyan-500/40 bg-cyan-950/50 px-2.5 py-0.5 font-mono text-xs font-bold text-cyan-300 shadow-[0_0_8px_rgba(6,182,212,0.3)]">
                  #{order.code}
                </span>
                <span className="px-2.5 py-0.5 rounded-full text-xs font-bold font-mono border border-emerald-500/40 bg-emerald-500/10 text-emerald-300 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                  <span>Documento Oficial</span>
                </span>
              </div>
              <p className="mt-1 text-xs text-slate-400 flex flex-wrap items-center gap-2">
                <span>Cliente: <strong className="text-cyan-200">{order.customer.name}</strong></span>
                <span>•</span>
                <span>Fecha: <strong className="text-slate-300 font-mono">{order.createdAt || '2026-09-25'}</strong></span>
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
              <span>Imprimir / Guardar PDF</span>
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

      {/* Printable Invoice Container */}
      <div className="flex justify-center">
        <div className="w-full max-w-4xl bg-white text-slate-900 rounded-3xl p-6 sm:p-10 shadow-2xl border border-slate-200">
          {/* Header */}
          <div className="flex flex-col sm:flex-row justify-between items-start gap-4 pb-6 border-b border-slate-200">
            <div>
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-cyan-600 text-white flex items-center justify-center font-black text-base">
                  R
                </div>
                <span className="text-2xl font-black tracking-tight text-slate-950">RADAR AUTO PARTS</span>
              </div>
              <p className="text-xs text-slate-500 mt-1">Sistemas de Autopartes y Logística Express</p>
              <p className="text-xs text-slate-500">RFC: RAP-260925-XYZ • Monterrey, N.L. / TX, USA</p>
            </div>
            <div className="sm:text-right">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-400 block font-mono">
                FACTURA / COMPROBANTE
              </span>
              <p className="text-2xl font-black font-mono text-cyan-700">#{order.code}</p>
              <p className="text-xs text-slate-600 font-mono mt-0.5">
                Emisión: {order.createdAt || new Date().toISOString().slice(0, 10)}
              </p>
            </div>
          </div>

          {/* Customer & Delivery Data */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 py-6 border-b border-slate-200 text-xs">
            <div>
              <span className="font-bold text-slate-400 uppercase tracking-wider block mb-1">FACTURADO A:</span>
              <p className="text-sm font-black text-slate-950">{order.customer.name}</p>
              {order.customer.company && <p className="text-slate-700 font-medium">{order.customer.company}</p>}
              <p className="text-slate-600 font-mono">Tel: {order.customer.phone}</p>
              <p className="text-slate-600">{order.customer.email || 'N/A'}</p>
            </div>
            <div>
              <span className="font-bold text-slate-400 uppercase tracking-wider block mb-1">DETALLES DE ENTREGA:</span>
              <p className="font-semibold text-slate-800">
                Modalidad: <span className="uppercase font-bold text-cyan-800">{order.deliveryType === 'envio_domicilio' ? 'Envío a Domicilio' : 'Retiro en Sucursal'}</span>
              </p>
              <p className="text-slate-600 mt-0.5">
                {order.customer.shippingAddress || order.customer.location || 'Retiro en Tienda Matriz'}
              </p>
              <p className="text-slate-600 mt-0.5 font-mono">Asesor: {order.advisor}</p>
            </div>
          </div>

          {/* Vehicle specs */}
          <div className="py-4 bg-slate-50 rounded-2xl px-5 my-6 border border-slate-200 text-xs">
            <span className="font-bold text-slate-500 uppercase tracking-wider block mb-1">VEHÍCULO DESTINO:</span>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
              <span className="font-bold text-slate-900">
                {order.vehicle.year} {order.vehicle.make} {order.vehicle.model} {order.vehicle.trim || ''}
              </span>
              <span className="text-slate-600 font-mono">VIN: {order.vehicle.vin}</span>
              <span className="text-slate-600 font-mono">Placas: {order.vehicle.plate || 'N/A'}</span>
            </div>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead>
                <tr className="border-b-2 border-slate-300 text-slate-500 uppercase font-mono">
                  <th className="py-2.5">Descripción de la Refacción</th>
                  <th className="py-2.5 text-center">Garantía</th>
                  <th className="py-2.5 text-right">Importe USD</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-sans">
                <tr>
                  <td className="py-3.5">
                    <strong className="block text-slate-900 text-sm">{order.mainPart}</strong>
                    <span className="text-slate-500 text-[11px]">
                      Stock: #{order.stockNumber || 'STK-2026'} • Especificaciones probadas en banco
                    </span>
                  </td>
                  <td className="py-3.5 text-center font-mono font-bold text-emerald-700">
                    {order.warrantyDays || 60} Días
                  </td>
                  <td className="py-3.5 text-right font-mono font-bold text-slate-900">
                    ${partPrice.toFixed(2)}
                  </td>
                </tr>
                {deliveryFee > 0 && (
                  <tr>
                    <td className="py-2.5 text-slate-700">Flete y Logística de Despacho</td>
                    <td className="py-2.5 text-center text-slate-400 font-mono">-</td>
                    <td className="py-2.5 text-right font-mono font-bold text-slate-900">
                      ${deliveryFee.toFixed(2)}
                    </td>
                  </tr>
                )}
                {coreFee > 0 && (
                  <tr>
                    <td className="py-2.5 text-slate-700">Depósito por Devolución de Casco (Core)</td>
                    <td className="py-2.5 text-center text-slate-400 font-mono">-</td>
                    <td className="py-2.5 text-right font-mono font-bold text-slate-900">
                      ${coreFee.toFixed(2)}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Totals */}
          <div className="flex flex-col sm:flex-row justify-between items-start pt-6 border-t-2 border-slate-300 gap-6 mt-6">
            <div className="text-xs text-slate-500 space-y-1 max-w-sm">
              <p className="font-bold text-slate-700">TÉRMINOS Y POLÍTICA DE GARANTÍA:</p>
              <p>• La garantía ampara fallas mecánicas y defectos funcionales de origen por {order.warrantyDays || 60} días.</p>
              <p>• No cubre sobrecalentamiento extremo o manipulación indebida de sellos.</p>
            </div>

            <div className="w-full sm:w-64 space-y-2 text-xs font-mono">
              <div className="flex justify-between text-slate-600">
                <span>Subtotal Bruto:</span>
                <span>${grossSubtotal.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-emerald-700 font-bold">
                <span>Abono Registrado:</span>
                <span>-${downPayment.toFixed(2)}</span>
              </div>
              <div className="flex justify-between border-t border-slate-200 pt-2 text-sm font-black text-slate-950">
                <span>SALDO PENDIENTE:</span>
                <span className="text-cyan-800">${totalPayable.toFixed(2)} USD</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
