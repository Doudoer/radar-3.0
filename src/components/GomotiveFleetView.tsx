import React, { useEffect, useState } from 'react';
import { apiFetch } from '../services/apiFetch';

interface FleetVehicle {
  id: string;
  unit: string;
  driver: string;
  status: 'En ruta' | 'En reposo' | 'Alerta crítica';
  location: string;
  lastUpdate: string;
  idleMinutes: number;
  alert: string;
  x: number;
  y: number;
  color: string;
}

const fallbackFleet: FleetVehicle[] = [
  {
    id: 'GOM-101',
    unit: 'GOM-101',
    driver: 'Luis Ramírez',
    status: 'En ruta',
    location: 'Monterrey, NL',
    lastUpdate: 'hace 3 min',
    idleMinutes: 18,
    alert: 'Sin incidencias',
    x: 42,
    y: 32,
    color: '#22c55e',
  },
  {
    id: 'GOM-204',
    unit: 'GOM-204',
    driver: 'Ana Torres',
    status: 'En reposo',
    location: 'San Jerónimo, NL',
    lastUpdate: 'hace 12 min',
    idleMinutes: 146,
    alert: 'Tiempo de inactividad prolongado',
    x: 58,
    y: 52,
    color: '#fbbf24',
  },
  {
    id: 'GOM-318',
    unit: 'GOM-318',
    driver: 'Mario Soto',
    status: 'Alerta crítica',
    location: 'Apodaca, NL',
    lastUpdate: 'hace 1 min',
    idleMinutes: 204,
    alert: 'Temperatura alta / batería baja',
    x: 68,
    y: 40,
    color: '#f43f5e',
  },
  {
    id: 'GOM-412',
    unit: 'GOM-412',
    driver: 'Eduardo León',
    status: 'En ruta',
    location: 'Guadalupe, NL',
    lastUpdate: 'hace 5 min',
    idleMinutes: 34,
    alert: 'Sin incidencias',
    x: 76,
    y: 58,
    color: '#22c55e',
  },
];

const statusStyles: Record<FleetVehicle['status'], string> = {
  'En ruta': 'bg-emerald-500/15 text-emerald-300 border border-emerald-400/30',
  'En reposo': 'bg-amber-500/15 text-amber-200 border border-amber-400/30',
  'Alerta crítica': 'bg-rose-500/15 text-rose-200 border border-rose-400/30',
};

export const GomotiveFleetView: React.FC = () => {
  const [fleet, setFleet] = useState<FleetVehicle[]>(fallbackFleet);

  useEffect(() => {
    apiFetch('/gomotive/vehicles')
      .then(async (response) => {
        if (!response.ok) throw new Error('API not available');
        const data = await response.json();
        if (Array.isArray(data) && data.length > 0) setFleet(data as FleetVehicle[]);
      })
      .catch(() => setFleet(fallbackFleet));
  }, []);

  const criticalAlerts = fleet.filter((vehicle) => vehicle.status === 'Alerta crítica');
  const idleUnits = fleet.filter((vehicle) => vehicle.idleMinutes >= 120);

  return (
    <div className="radar-view">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-[#60a5fa]">GOMotive</p>
          <h2 className="text-2xl md:text-3xl font-bold text-[#e2e8f0] mt-1">Mapeo y alertas críticas</h2>
        </div>
        <button className="rounded-xl border border-[#2d3d5f] bg-[#111c2f] px-4 py-2 text-sm text-[#dfe2ef] shadow-sm hover:bg-[#152541] transition-colors">
          Actualizar mapa
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="rounded-2xl border border-[#1d2d48] bg-[#0e1729] p-4">
          <div className="text-xs text-[#8ea3c7]">Unidades en reposo</div>
          <div className="mt-3 text-3xl font-bold text-white">{idleUnits.length}</div>
          <div className="mt-2 text-xs text-amber-300">Más de 120 min</div>
        </div>

        <div className="rounded-2xl border border-[#1d2d48] bg-[#0e1729] p-4">
          <div className="text-xs text-[#8ea3c7]">Alertas críticas</div>
          <div className="mt-3 text-3xl font-bold text-white">{criticalAlerts.length}</div>
          <div className="mt-2 text-xs text-rose-300">Atención inmediata</div>
        </div>

        <div className="rounded-2xl border border-[#1d2d48] bg-[#0e1729] p-4">
          <div className="text-xs text-[#8ea3c7]">Última actualización</div>
          <div className="mt-3 text-2xl font-bold text-white">3 min</div>
          <div className="mt-2 text-xs text-emerald-300">Sin interrupciones</div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1.4fr_0.8fr] gap-4">
        <div className="rounded-2xl border border-[#1d2d48] bg-[#0d1728] p-4 shadow-[0_10px_30px_rgba(15,23,42,0.35)]">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-lg font-semibold text-white">Mis vehículos GOMotive</h3>
            <span className="text-xs text-[#8ea3c7]">Live tracking</span>
          </div>

          <div className="mb-4 grid grid-cols-1 md:grid-cols-2 gap-3">
            {fleet.map((vehicle) => (
              <div key={vehicle.id} className="rounded-xl border border-[#1d2d48] bg-[#101c30] p-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="text-sm font-semibold text-[#edf2ff]">{vehicle.unit}</div>
                    <div className="text-[11px] text-[#8ea3c7]">{vehicle.driver}</div>
                  </div>
                  <span className={`rounded-full px-2 py-1 text-[10px] font-medium ${statusStyles[vehicle.status]}`}>
                    {vehicle.status}
                  </span>
                </div>
                <div className="mt-3 flex items-center justify-between text-[11px] text-[#ced7ea]">
                  <span>{vehicle.location}</span>
                  <span>{vehicle.idleMinutes} min</span>
                </div>
              </div>
            ))}
          </div>

          <div className="relative h-[420px] overflow-hidden rounded-2xl border border-[#1f2f4b] bg-[radial-gradient(circle_at_20%_20%,rgba(96,165,250,0.2),transparent_20%),linear-gradient(135deg,#0a1527_0%,#101d30_40%,#0d1729_100%)]">
            <div className="absolute inset-0 opacity-30" style={{backgroundImage: 'linear-gradient(rgba(148,163,184,0.12) 1px, transparent 1px), linear-gradient(90deg, rgba(148,163,184,0.12) 1px, transparent 1px)', backgroundSize: '32px 32px'}} />
            <div className="absolute inset-0 opacity-20" style={{background: 'radial-gradient(circle at 70% 35%, rgba(34,197,94,0.2), transparent 20%), radial-gradient(circle at 20% 70%, rgba(251,191,36,0.15), transparent 25%)'}} />

            {fleet.map((vehicle) => (
              <div
                key={vehicle.id}
                className="absolute -translate-x-1/2 -translate-y-1/2"
                style={{ left: `${vehicle.x}%`, top: `${vehicle.y}%` }}
              >
                <div className="relative flex flex-col items-center">
                  <div
                    className="h-4 w-4 rounded-full border-2 border-white shadow-[0_0_18px_rgba(255,255,255,0.7)]"
                    style={{ background: vehicle.color }}
                  />
                  <div className="mt-2 rounded-full border border-[#20314a] bg-[#0e1729]/90 px-2 py-1 text-[10px] font-medium text-[#dfe2ef] whitespace-nowrap">
                    {vehicle.unit}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <div className="rounded-2xl border border-[#1d2d48] bg-[#0d1728] p-4">
            <h3 className="text-lg font-semibold text-white">Tiempo estacionado</h3>
            <div className="mt-4 space-y-3">
              {fleet.map((vehicle) => (
                <div key={vehicle.id} className="rounded-xl border border-[#1d2d48] bg-[#101c30] p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-[#edf2ff]">{vehicle.unit}</div>
                      <div className="text-xs text-[#8ea3c7]">{vehicle.location}</div>
                    </div>
                    <span className={`rounded-full px-2 py-1 text-[10px] font-medium ${statusStyles[vehicle.status]}`}>
                      {vehicle.status}
                    </span>
                  </div>
                  <div className="mt-3 flex items-center justify-between text-xs text-[#cbd5e1]">
                    <span>Estacionado</span>
                    <span className="font-semibold text-white">{vehicle.idleMinutes} min</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-[#1d2d48] bg-[#0d1728] p-4">
            <h3 className="text-lg font-semibold text-white">Alertas críticas</h3>
            <div className="mt-4 space-y-3">
              {criticalAlerts.length > 0 ? (
                criticalAlerts.map((vehicle) => (
                  <div key={vehicle.id} className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm font-semibold text-rose-100">{vehicle.unit}</div>
                      <span className="rounded-full bg-rose-500/20 px-2 py-1 text-[10px] text-rose-100">CRÍTICO</span>
                    </div>
                    <div className="mt-2 text-xs text-rose-100/80">{vehicle.alert}</div>
                    <div className="mt-2 text-[11px] text-rose-200">Requiere intervención inmediata</div>
                  </div>
                ))
              ) : (
                <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-100">
                  No hay alertas críticas en este momento.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
