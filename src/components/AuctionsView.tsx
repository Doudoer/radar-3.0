import React, { useState } from 'react';
import { Order } from '../types';

interface AuctionsViewProps {
  orders: Order[];
  onOpenAuctionModal: (order: Order) => void;
}

export const AuctionsView: React.FC<AuctionsViewProps> = ({
  orders,
  onOpenAuctionModal,
}) => {
  const [selectedCategory, setSelectedCategory] = useState('Todos');

  const auctionLots = [
    {
      id: 'LOT-2026-901',
      title: 'Audi Q5 Sportback 2023 - Salvamento / Recuperado',
      vin: 'WAUZZZF27PA098124',
      plates: 'PZX-892-C',
      currentBid: 685000,
      reservePrice: 650000,
      totalBids: 14,
      timeLeft: '04h 32m 10s',
      topBidder: 'Grupo Automotriz Sur',
      image: 'https://images.unsplash.com/photo-1603584173870-7f23fdae1b7a?w=800&auto=format&fit=crop&q=80',
      damageType: 'Impacto Frontal Leve - Motor Íntegro',
      category: 'Vehículos',
    },
    {
      id: 'LOT-2026-902',
      title: 'Lote de 4 Motores BMW TwinPower Turbo 2.0L (B48)',
      vin: 'N/A - LOTE REPUESTOS',
      plates: 'S/P',
      currentBid: 240000,
      reservePrice: 200000,
      totalBids: 9,
      timeLeft: '01h 15m 45s',
      topBidder: 'Refaccionaria Monterrey',
      image: 'https://images.unsplash.com/photo-1486006920555-c77dce18193b?w=800&auto=format&fit=crop&q=80',
      damageType: 'Desmonte Certificado OEM',
      category: 'Piezas & Lotes',
    },
    {
      id: 'LOT-2026-903',
      title: 'Porsche Macan GTS 2021 - Sin Rodar',
      vin: 'WP1AA2A55ML109822',
      plates: 'MZN-441-A',
      currentBid: 1120000,
      reservePrice: 1050000,
      totalBids: 22,
      timeLeft: '18h 00m 00s',
      topBidder: 'Premium Cars Polanco',
      image: 'https://images.unsplash.com/photo-1503376780353-7e6692767b70?w=800&auto=format&fit=crop&q=80',
      damageType: 'Recuperación Aseguradora - Estético',
      category: 'Vehículos',
    },
  ];

  const filteredLots = auctionLots.filter(
    (lot) => selectedCategory === 'Todos' || lot.category === selectedCategory
  );

  return (
    <div className="flex flex-col gap-6 animate-fade-in max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-[#111827]/80 p-5 rounded-xl border border-[#1e293b] backdrop-blur-md">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="material-symbols-outlined text-[#f59e0b] text-[26px]">gavel</span>
            <h1 className="text-xl font-bold text-[#f1f5f9] tracking-tight">Mesa de Subastas en Vivo</h1>
          </div>
          <p className="text-xs text-[#94a3b8] mt-1">
            Subastas electrónicas de vehículos recuperados, unidades en consignación y lotes de componentes.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 bg-[#1e293b] px-3 py-1.5 rounded-lg border border-[#334155] text-xs text-[#f1f5f9]">
            <span className="w-2 h-2 rounded-full bg-[#10b981] animate-ping" />
            <span className="font-semibold text-[#10b981]">3 Subastas Activas</span>
          </div>

          <button className="bg-[#f59e0b] hover:bg-[#d97706] text-[#0a1120] font-bold text-xs py-2 px-4 rounded-lg flex items-center gap-2 transition-all cursor-pointer shadow-[0_0_12px_rgba(245,158,11,0.3)]">
            <span className="material-symbols-outlined text-[18px]">add_circle</span>
            <span>Publicar Lote</span>
          </button>
        </div>
      </div>

      {/* Category Pills */}
      <div className="flex gap-2">
        {['Todos', 'Vehículos', 'Piezas & Lotes'].map((cat) => (
          <button
            key={cat}
            onClick={() => setSelectedCategory(cat)}
            className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
              selectedCategory === cat
                ? 'bg-[#f59e0b] text-[#0a1120] shadow-[0_0_12px_rgba(245,158,11,0.25)]'
                : 'bg-[#1e293b] text-[#94a3b8] hover:text-[#f1f5f9]'
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Auction Lots Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {filteredLots.map((lot) => (
          <div
            key={lot.id}
            className="bg-[#0f172a] border border-[#1e293b] hover:border-[#f59e0b]/50 rounded-xl overflow-hidden flex flex-col group transition-all duration-200 shadow-lg"
          >
            {/* Image & Timer Badge */}
            <div className="relative h-48 w-full overflow-hidden bg-black/40">
              <img
                src={lot.image}
                alt={lot.title}
                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500 opacity-90"
              />
              <div className="absolute top-3 left-3 bg-[#0b1329]/85 backdrop-blur-md px-2.5 py-1 rounded-md text-[11px] font-mono font-bold text-[#f59e0b] border border-[#f59e0b]/40 flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[14px]">timer</span>
                <span>{lot.timeLeft}</span>
              </div>
              <div className="absolute top-3 right-3 bg-[#0b1329]/85 backdrop-blur-md px-2 py-0.5 rounded text-[10px] text-[#cbd5e1] border border-[#1e293b]">
                {lot.id}
              </div>
            </div>

            {/* Content */}
            <div className="p-4 flex-1 flex flex-col gap-3">
              <div>
                <h3 className="font-semibold text-sm text-[#f1f5f9] group-hover:text-[#f59e0b] transition-colors leading-snug">
                  {lot.title}
                </h3>
                <span className="text-[11px] text-[#64748b] block mt-0.5">{lot.damageType}</span>
              </div>

              <div className="bg-[#0b1329] p-3 rounded-lg border border-[#1e293b] flex items-center justify-between text-xs">
                <div>
                  <span className="text-[10px] text-[#64748b] uppercase block">Oferta Actual</span>
                  <span className="text-base font-bold text-[#10b981]">
                    ${lot.currentBid.toLocaleString()} MXN
                  </span>
                </div>
                <div className="text-right">
                  <span className="text-[10px] text-[#64748b] uppercase block">Pujas</span>
                  <span className="font-semibold text-[#58a6ff]">{lot.totalBids} ofertas</span>
                </div>
              </div>

              <div className="text-[11px] text-[#94a3b8] flex justify-between items-center border-t border-[#1e293b] pt-2">
                <span>Líder: <strong className="text-[#e2e8f0]">{lot.topBidder}</strong></span>
                <span className="text-[#10b981] font-medium">Reserva superada</span>
              </div>

              <button
                onClick={() => {
                  const matched = orders.find((o) => o.code === 'ORD-8924A') || orders[0];
                  if (matched) onOpenAuctionModal(matched);
                }}
                className="w-full mt-auto py-2 px-4 rounded-lg bg-[#f59e0b] hover:bg-[#d97706] text-[#0a1120] font-bold text-xs flex items-center justify-center gap-2 transition-all cursor-pointer shadow-[0_0_10px_rgba(245,158,11,0.2)]"
              >
                <span className="material-symbols-outlined text-[16px]">gavel</span>
                <span>Pujar / Ver Subasta</span>
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
