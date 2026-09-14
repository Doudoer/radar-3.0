import React from 'react';
import { Order } from '../types';

interface InvoiceModalProps {
  isOpen: boolean;
  onClose: () => void;
  order: Order;
}

export const InvoiceModal: React.FC<InvoiceModalProps> = ({
  isOpen,
  onClose,
  order,
}) => {
  if (!isOpen) return null;

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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-sm animate-fade-in">
      <div className="bg-[#0f172a] border border-[#334155] rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl flex flex-col text-[#f8fafc]">
        {/* Modal Controls Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#334155] bg-[#0b1329] rounded-t-2xl">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[#388bfd]">receipt_long</span>
            <h3 className="font-bold text-base">Comprobante / Invoice Oficial #{order.code}</h3>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handlePrint}
              className="px-3 py-1.5 rounded-lg bg-[#388bfd] hover:bg-[#2563eb] text-[#0a1120] font-bold text-xs flex items-center gap-1.5 cursor-pointer shadow"
            >
              <span className="material-symbols-outlined text-[16px]">print</span>
              <span>Imprimir</span>
            </button>
            <button
              onClick={onClose}
              className="p-1 text-[#94a3b8] hover:text-[#f8fafc] rounded-lg hover:bg-[#1e293b] cursor-pointer"
            >
              <span className="material-symbols-outlined text-[20px]">close</span>
            </button>
          </div>
        </div>

        {/* Printable Area (White / High Contrast Theme for standard document print) */}
        <div className="p-8 bg-white text-slate-900 flex flex-col gap-6" id="printable-invoice">
          {/* Header */}
          <div className="flex justify-between items-start border-b border-slate-200 pb-6">
            <div>
              <h1 className="text-2xl font-black tracking-tight text-blue-900">RADAR AUTO PARTS</h1>
              <p className="text-xs text-slate-500 font-medium">División de Autopartes & Operaciones Call Center</p>
              <p className="text-xs text-slate-500">Raleigh, NC • Tel: (919) 903-5996</p>
            </div>
            <div className="text-right">
              <span className="text-xs font-bold uppercase text-slate-400">FACTURA / RECIBO</span>
              <h2 className="text-xl font-mono font-black text-slate-900">#{order.code}</h2>
              <p className="text-xs text-slate-500 mt-1">Fecha: {order.createdAt || '24 Oct 2026'}</p>
              <p className="text-xs text-slate-500">Asesor: {order.advisor}</p>
            </div>
          </div>

          {/* Client & Vehicle Info */}
          <div className="grid grid-cols-2 gap-6 text-xs bg-slate-50 p-4 rounded-xl border border-slate-200">
            <div>
              <span className="font-bold text-slate-400 uppercase text-[10px] block mb-1">CLIENTE / COMPRADOR</span>
              <p className="font-bold text-slate-900 text-sm">{order.customer.name}</p>
              {order.customer.company && <p className="text-slate-600 font-medium">{order.customer.company}</p>}
              <p className="text-slate-600">Tel: {order.customer.phone}</p>
              <p className="text-slate-600">{order.customer.email}</p>
              <p className="text-slate-600">{order.customer.shippingAddress || order.customer.location}</p>
            </div>
            <div>
              <span className="font-bold text-slate-400 uppercase text-[10px] block mb-1">VEHÍCULO ASOCIADO</span>
              <p className="font-bold text-slate-900 text-sm">
                {order.vehicle.year} {order.vehicle.make} {order.vehicle.model}
              </p>
              <p className="font-mono text-slate-700">VIN: {order.vehicle.vin}</p>
              <p className="text-slate-600">Placa: {order.vehicle.plate} • Trim: {order.vehicle.trim || 'N/A'}</p>
              <p className="text-slate-600 font-semibold mt-1">
                Tipo de Entrega: {order.deliveryType === 'envio_domicilio' ? '🚚 Envío a Domicilio' : '🏪 Retiro en Tienda'}
              </p>
            </div>
          </div>

          {/* Table Breakdown */}
          <div className="border border-slate-200 rounded-xl overflow-hidden">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-100 text-slate-600 font-bold border-b border-slate-200">
                <tr>
                  <th className="p-3">Descripción de la Refacción / Servicio</th>
                  <th className="p-3 text-center">Stock #</th>
                  <th className="p-3 text-right">Monto</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-slate-800">
                <tr>
                  <td className="p-3">
                    <p className="font-bold text-slate-900">{order.mainPart}</p>
                    <p className="text-[11px] text-slate-500 font-mono">{order.productSpecs || order.notes || 'Especificación de compatibilidad verificada'}</p>
                  </td>
                  <td className="p-3 text-center font-mono font-bold text-slate-700">
                    {order.stockNumber || 'STK-2026-098'}
                  </td>
                  <td className="p-3 text-right font-mono font-bold text-slate-900">
                    ${partPrice.toFixed(2)}
                  </td>
                </tr>
                {deliveryFee > 0 && (
                  <tr>
                    <td className="p-3 text-slate-700 font-medium">Costo de Flete / Delivery a Domicilio</td>
                    <td className="p-3 text-center text-slate-400">-</td>
                    <td className="p-3 text-right font-mono font-bold text-slate-900">${deliveryFee.toFixed(2)}</td>
                  </tr>
                )}
                {coreFee > 0 && (
                  <tr>
                    <td className="p-3 text-slate-700 font-medium">Depósito por Core Fee (Reembolsable con entrega física de pieza usada)</td>
                    <td className="p-3 text-center text-slate-400">CORE</td>
                    <td className="p-3 text-right font-mono font-bold text-slate-900">${coreFee.toFixed(2)}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Financial Totals */}
          <div className="flex justify-end">
            <div className="w-72 flex flex-col gap-1.5 text-xs">
              <div className="flex justify-between text-slate-600">
                <span>Monto de la Parte:</span>
                <span className="font-mono font-bold">${partPrice.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>Monto de Delivery:</span>
                <span className="font-mono font-bold">${deliveryFee.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>Monto del Core Fee:</span>
                <span className="font-mono font-bold">${coreFee.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-slate-600 font-semibold border-t border-slate-200 pt-1">
                <span>Subtotal de Cargos:</span>
                <span className="font-mono font-bold">${grossSubtotal.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-amber-700 font-bold">
                <span>Abono / Downpayment:</span>
                <span className="font-mono">-{downPayment > 0 ? `$${downPayment.toFixed(2)}` : '$0.00'}</span>
              </div>
              <div className="flex justify-between text-blue-950 font-black text-sm border-t-2 border-slate-900 pt-1.5 mt-1">
                <span>TOTAL A PAGAR:</span>
                <span className="font-mono text-base">${totalPayable.toFixed(2)}</span>
              </div>
            </div>
          </div>

          {/* Warranty Terms Footer */}
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 text-[11px] text-slate-600 leading-relaxed">
            <p className="font-bold text-slate-800 mb-0.5">TÉRMINOS DE GARANTÍA RADAR:</p>
            <p>
              Garantía estándar de <strong>{order.warrantyDays || 60} días</strong> a partir de la fecha de entrega física. Cubre defectos mecánicos e internos del tren motriz. Válida presentando esta factura y número de orden.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
