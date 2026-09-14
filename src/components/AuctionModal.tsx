import React, { useState } from 'react';
import { Order, AuctionBid } from '../types';

interface AuctionModalProps {
  isOpen: boolean;
  onClose: () => void;
  order: Order | null;
  onAddBid: (orderId: string, bid: AuctionBid) => void;
}

export const AuctionModal: React.FC<AuctionModalProps> = ({
  isOpen,
  onClose,
  order,
  onAddBid,
}) => {
  const [bidderName, setBidderName] = useState('Autos Seminuevos Premier');
  const [bidAmount, setBidAmount] = useState('860000');
  const [submitted, setSubmitted] = useState(false);

  if (!isOpen || !order) return null;

  const currentLeadingAmount = order.bids && order.bids.length > 0 ? order.bids[0].amount : 850000;

  const handlePlaceBid = (e: React.FormEvent) => {
    e.preventDefault();
    const amount = parseFloat(bidAmount);
    if (isNaN(amount) || amount <= 0) return;

    const newBid: AuctionBid = {
      id: `BID-${Date.now()}`,
      bidder: bidderName,
      bidderInitial: bidderName[0].toUpperCase(),
      amount: amount,
      timeAgo: 'Justo ahora',
      isLeading: amount > currentLeadingAmount,
    };

    onAddBid(order.id, newBid);
    setSubmitted(true);
    setTimeout(() => {
      setSubmitted(false);
      onClose();
    }, 1200);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md">
      <div className="bg-[#181b25] border border-[rgba(255,255,255,0.12)] rounded-2xl w-full max-w-xl shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-4 border-b border-[rgba(255,255,255,0.08)] flex justify-between items-center bg-[#1c1f29]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#d0bcff]/20 text-[#d0bcff] flex items-center justify-center border border-[#d0bcff]/30">
              <span className="material-symbols-outlined text-[18px]">gavel</span>
            </div>
            <div>
              <h3 className="font-headline-sm text-base font-bold text-[#dfe2ef]">
                Subasta Activa - Orden #{order.code}
              </h3>
              <p className="font-data-mono text-xs text-[#c2c6d6]">
                {order.vehicle.make} {order.vehicle.model} ({order.vehicle.plate})
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-[#c2c6d6] hover:text-white p-1 rounded hover:bg-[#31353f] transition-colors cursor-pointer"
          >
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>

        {/* Content */}
        <div className="p-5 flex flex-col gap-4 text-xs">
          {/* Top stats */}
          <div className="grid grid-cols-2 gap-3 p-3 bg-[#0a0e17] rounded-xl border border-[rgba(255,255,255,0.08)]">
            <div>
              <span className="font-data-label text-[10px] text-[#c2c6d6] uppercase tracking-wider block">
                Postura Líder Actual
              </span>
              <span className="font-display-lg font-data-mono text-xl font-bold text-[#4d8eff] block mt-0.5">
                ${currentLeadingAmount.toLocaleString('es-MX')}
              </span>
            </div>
            <div>
              <span className="font-data-label text-[10px] text-[#c2c6d6] uppercase tracking-wider block">
                Total de Posturas
              </span>
              <span className="font-display-lg font-data-mono text-xl font-bold text-[#4edea3] block mt-0.5">
                {order.bids?.length || 0} Ofertas
              </span>
            </div>
          </div>

          {/* Full Bids List */}
          <div>
            <h4 className="font-data-label text-[10px] text-[#c2c6d6] uppercase tracking-wider mb-2 font-semibold">
              Historial de Pujas Recibidas:
            </h4>
            <div className="max-h-40 overflow-y-auto space-y-1.5 pr-1">
              {(order.bids || []).map((bid, idx) => (
                <div
                  key={bid.id}
                  className={`p-2.5 rounded-lg border flex items-center justify-between transition-colors ${
                    idx === 0
                      ? 'bg-[#4d8eff]/10 border-[#4d8eff]/30 text-[#dfe2ef]'
                      : 'bg-[#0a0e17] border-[rgba(255,255,255,0.06)] text-[#c2c6d6]'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded-full bg-[#31353f] flex items-center justify-center font-bold text-[10px] text-white">
                      {bid.bidderInitial}
                    </div>
                    <div>
                      <span className="font-medium text-[#dfe2ef] block leading-none">
                        {bid.bidder}
                      </span>
                      <span className="font-data-label text-[10px] text-[#c2c6d6] opacity-75">
                        {bid.timeAgo}
                      </span>
                    </div>
                  </div>
                  <span className="font-data-mono font-bold text-[#4edea3] text-sm">
                    ${bid.amount.toLocaleString('es-MX')}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* New Bid Form */}
          <form
            onSubmit={handlePlaceBid}
            className="pt-3 border-t border-[rgba(255,255,255,0.08)] flex flex-col gap-3"
          >
            <h4 className="font-data-label text-[10px] text-[#d0bcff] uppercase tracking-wider font-semibold">
              Registrar Nueva Postura:
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block mb-1 text-[#c2c6d6]">Nombre del Comprador / Lote</label>
                <input
                  type="text"
                  required
                  value={bidderName}
                  onChange={(e) => setBidderName(e.target.value)}
                  className="w-full bg-[#0a0e17] border border-[rgba(255,255,255,0.1)] rounded-lg p-2 text-[#dfe2ef] focus:outline-none focus:border-[#d0bcff]"
                />
              </div>
              <div>
                <label className="block mb-1 text-[#c2c6d6]">Monto Ofertado (MXN)</label>
                <input
                  type="number"
                  required
                  value={bidAmount}
                  onChange={(e) => setBidAmount(e.target.value)}
                  className="w-full bg-[#0a0e17] border border-[rgba(255,255,255,0.1)] rounded-lg p-2 font-data-mono font-bold text-[#4edea3] focus:outline-none focus:border-[#d0bcff]"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="px-3 py-1.5 rounded-lg bg-[#31353f] text-[#c2c6d6] hover:text-white transition-colors cursor-pointer"
              >
                Cerrar
              </button>
              <button
                type="submit"
                disabled={submitted}
                className="px-4 py-1.5 rounded-lg bg-[#d0bcff] text-[#23005c] font-bold hover:bg-[#e9ddff] transition-all flex items-center gap-1.5 cursor-pointer shadow-[0_0_12px_rgba(208,188,255,0.4)]"
              >
                <span className="material-symbols-outlined text-[16px]">add_circle</span>
                <span>{submitted ? '¡Postura Registrada!' : 'Confirmar Puja'}</span>
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};
