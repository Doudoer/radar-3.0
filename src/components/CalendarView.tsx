import React from 'react';

export const CalendarView: React.FC = () => {
  const events = [
    { time: '09:00 AM', title: 'Entrega Audi Q5 Sportback (ORD-8924A)', client: 'Roberto Sánchez', bay: 'Bahía 1' },
    { time: '11:30 AM', title: 'Diagnóstico Mayor Hilux (ORD-8921)', client: 'Martín Rodríguez', bay: 'Bahía 4' },
    { time: '02:00 PM', title: 'Revisión Frenos MB Sprinter (ORD-8915)', client: 'Transportes Ruta Sur', bay: 'Bahía 2' },
    { time: '04:30 PM', title: 'Prueba de Ruta Honda Civic (ORD-8918)', client: 'Laura Álvarez', bay: 'Pista' },
  ];

  return (
    <div className="radar-view">
      <div>
        <h2 className="font-headline-md text-2xl md:text-3xl font-bold text-[#dfe2ef] tracking-tight mb-1">
          Agenda de Bahías y Citas de Taller
        </h2>
        <p className="font-body-md text-[14px] text-[#c2c6d6]">
          Programación de recepciones de vehículos, citas técnicas y entregas.
        </p>
      </div>

      <div className="glass-card rounded-xl p-5 shadow-sm">
        <h3 className="font-headline-sm text-base font-bold text-[#dfe2ef] mb-4">
          Citas para Hoy ({new Date().toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' })})
        </h3>
        <div className="space-y-3">
          {events.map((ev, i) => (
            <div key={i} className="p-3.5 bg-[#0a0e17] rounded-xl border border-[rgba(255,255,255,0.06)] flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="font-data-mono font-bold text-[#4d8eff] text-xs bg-[#4d8eff]/10 px-2.5 py-1 rounded">
                  {ev.time}
                </span>
                <div>
                  <h4 className="text-xs font-semibold text-[#dfe2ef]">{ev.title}</h4>
                  <p className="text-[11px] text-[#c2c6d6]">{ev.client}</p>
                </div>
              </div>
              <span className="text-xs font-data-mono bg-[#31353f] text-[#4edea3] px-2.5 py-1 rounded">
                {ev.bay}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
