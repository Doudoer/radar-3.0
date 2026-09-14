import React from 'react';

export const DirectoryView: React.FC = () => {
  const contacts = [
    { name: 'Carlos Mendoza', role: 'Asesor Líder de Ventas & Crédito', email: 'carlos.mendoza@radar.io', phone: '+52 55 9876 5432', dept: 'Comercial' },
    { name: 'Marcos Rivas', role: 'Jefe de Taller Mecánico', email: 'marcos.rivas@radar.io', phone: '+52 55 4567 8901', dept: 'Taller' },
    { name: 'Valeria Salas', role: 'Especialista en Repuestos & Garantías', email: 'valeria.salas@radar.io', phone: '+52 55 2345 6789', dept: 'Garantías' },
    { name: 'Roberto Sánchez', role: 'Cliente VIP - Corporativo', email: 'roberto.sanchez@empresa.com', phone: '+52 55 1234 5678', dept: 'Clientes' },
  ];

  return (
    <div className="w-full max-w-[1600px] mx-auto flex flex-col gap-6">
      <div>
        <h2 className="font-headline-md text-2xl md:text-3xl font-bold text-[#dfe2ef] tracking-tight mb-1">
          Directorio de Asesores & Clientes
        </h2>
        <p className="font-body-md text-[14px] text-[#c2c6d6]">
          Contactos directos, extensiones internas y canales de comunicación.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {contacts.map((c, i) => (
          <div key={i} className="glass-card rounded-xl p-4 flex flex-col gap-2.5 shadow-sm">
            <div className="w-10 h-10 rounded-full bg-[#31353f] border border-[rgba(255,255,255,0.08)] flex items-center justify-center font-bold text-[#dfe2ef]">
              {c.name.split(' ').map((n) => n[0]).join('').substring(0, 2)}
            </div>
            <h3 className="font-headline-sm text-sm font-bold text-[#dfe2ef]">{c.name}</h3>
            <p className="text-[11px] text-[#adc6ff] font-medium">{c.role}</p>
            <div className="text-xs text-[#c2c6d6] space-y-1 mt-2 border-t border-[rgba(255,255,255,0.08)] pt-2">
              <p className="truncate">✉ {c.email}</p>
              <p className="font-data-mono">📞 {c.phone}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
