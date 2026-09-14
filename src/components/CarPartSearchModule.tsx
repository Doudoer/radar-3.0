import React, { useState, useEffect } from 'react';
import { CarPartItem, IntermediateOption, PrefillOrderData } from '../types';
import {
  MAKE_MODEL_MAP,
  POPULAR_PARTS,
  SAMPLE_VINS,
  INTERMEDIATE_VARIANTS,
  INITIAL_CARPART_RESULTS,
} from '../data/carPartData';

interface CarPartSearchModuleProps {
  carpartEnabled?: boolean;
  userRole?: 'admin' | 'operador';
  onCreateOrderFromPart: (prefillData: PrefillOrderData) => void;
  onNavigateToSettings?: () => void;
}

export const CarPartSearchModule: React.FC<CarPartSearchModuleProps> = ({
  carpartEnabled = true,
  userRole = 'admin',
  onCreateOrderFromPart,
  onNavigateToSettings,
}) => {
  // Search Form State
  const [searchMode, setSearchMode] = useState<'vin' | 'vehicle'>('vin');
  const [vinInput, setVinInput] = useState('1FTEW1EP5KFB81920');
  const [selectedPart, setSelectedPart] = useState('Engine (Motor Completo)');
  const [zipcode, setZipcode] = useState('27520');

  // Manual Vehicle Cascade State
  const [vehicleYear, setVehicleYear] = useState<number>(2019);
  const [vehicleMake, setVehicleMake] = useState<string>('Ford');
  const [vehicleModel, setVehicleModel] = useState<string>('F-150');

  // Scraper & Execution State
  const [extractionMode, setExtractionMode] = useState<'extension' | 'backend'>('extension');
  const [isSearching, setIsSearching] = useState(false);
  const [searchTiming, setSearchTiming] = useState<number | null>(null);
  const [results, setResults] = useState<CarPartItem[]>(INITIAL_CARPART_RESULTS);

  // Filters & Sorting in Results
  const [sortBy, setSortBy] = useState<'price_asc' | 'miles_asc' | 'distance_asc' | 'grade_asc'>('price_asc');
  const [filterGrade, setFilterGrade] = useState<'all' | 'A' | 'B' | 'C'>('all');
  const [filterOwnYardOnly, setFilterOwnYardOnly] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  // Modals State
  const [isExtensionModalOpen, setIsExtensionModalOpen] = useState(false);
  const [intermediateModalData, setIntermediateModalData] = useState<{
    isOpen: boolean;
    title: string;
    options: IntermediateOption[];
    pendingSearchQuery?: any;
  }>({
    isOpen: false,
    title: '',
    options: [],
  });

  // Feedback Toast
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(null);
    }, 3000);
  };

  // Decode VIN in real time
  const decodedVinInfo = React.useMemo(() => {
    const cleanVin = vinInput.trim().toUpperCase();
    if (!cleanVin) return null;
    const match = SAMPLE_VINS.find((s) => s.vin.toUpperCase() === cleanVin);
    if (match) {
      return {
        year: match.year,
        make: match.make,
        model: match.model,
        engine: match.engine,
        matched: true,
      };
    }
    if (cleanVin.length === 17) {
      return {
        year: 2020,
        make: cleanVin.startsWith('1F') ? 'Ford' : cleanVin.startsWith('4T') ? 'Toyota' : cleanVin.startsWith('1G') ? 'Chevrolet' : cleanVin.startsWith('WAU') ? 'Audi' : 'Vehículo Detectado',
        model: cleanVin.startsWith('1F') ? 'F-150' : cleanVin.startsWith('4T') ? 'Camry' : cleanVin.startsWith('1G') ? 'Silverado 1500' : cleanVin.startsWith('WAU') ? 'Q5' : 'Modelo Base',
        engine: 'Especificación VIN Detectada',
        matched: false,
      };
    }
    return null;
  }, [vinInput]);

  // Handle Make change to update Model cascade
  const handleMakeChange = (newMake: string) => {
    setVehicleMake(newMake);
    const models = MAKE_MODEL_MAP[newMake] || [];
    if (models.length > 0) {
      setVehicleModel(models[0]);
    } else {
      setVehicleModel('');
    }
  };

  // Execute Search Workflow
  const handleExecuteSearch = (bypassIntermediate = false, chosenVariantTitle?: string) => {
    const targetMake = searchMode === 'vin' ? (decodedVinInfo?.make || 'Ford') : vehicleMake;
    const targetModel = searchMode === 'vin' ? (decodedVinInfo?.model || 'F-150') : vehicleModel;
    const partClean = selectedPart.split(' ')[0]; // 'Engine', 'Transmission', etc.

    // Check for intermediate options requirement
    const intermediateKey = `${targetMake}-${targetModel}-${partClean}`;
    if (!bypassIntermediate && INTERMEDIATE_VARIANTS[intermediateKey]) {
      setIntermediateModalData({
        isOpen: true,
        title: `Selección Intermedia: Variantes de ${partClean} para ${targetMake} ${targetModel}`,
        options: INTERMEDIATE_VARIANTS[intermediateKey],
        pendingSearchQuery: { targetMake, targetModel, targetYear: searchMode === 'vin' ? (decodedVinInfo?.year || 2019) : vehicleYear },
      });
      return;
    }

    setIsSearching(true);
    const startTime = performance.now();

    // Simulated latency: 2.2s for local Chrome Extension, 4.0s for backend Puppeteer
    const simulatedDelay = extractionMode === 'extension' ? 2200 : 3800;

    setTimeout(() => {
      const endTime = performance.now();
      setSearchTiming(parseFloat(((endTime - startTime) / 1000).toFixed(1)));
      setIsSearching(false);

      // Generate context-aware results
      const yr = searchMode === 'vin' ? (decodedVinInfo?.year || 2019) : vehicleYear;
      const mk = targetMake;
      const md = targetModel;
      const pt = selectedPart;
      const spec = chosenVariantTitle || (searchMode === 'vin' && decodedVinInfo?.engine ? decodedVinInfo.engine : `${pt} OEM Specification`);

      const newResults: CarPartItem[] = [
        {
          id: `CP-${Math.floor(1000 + Math.random() * 9000)}`,
          year: yr,
          make: mk,
          model: md,
          part: pt,
          title: `${yr} ${mk} ${md} - ${pt} (${spec})`,
          description: `RUNS GREAT TESTED, COMPRESSION 180 PSI ALL CYLINDERS, INCLUDES MANIFOLD & SENSORS`,
          partGrade: 'A',
          miles: 38400,
          price: 1750.0,
          dealerName: 'Rodriguez Auto Salvage & Yard',
          dealerLocation: 'Raleigh, NC',
          dealerPhone: '(919) 555-0199',
          distanceMiles: 8,
          stockNumber: `STK-RDZ-${Math.floor(1000 + Math.random() * 9000)}`,
          donorVin: searchMode === 'vin' ? vinInput : `${yr}VIN${Math.random().toString(36).substring(2, 9).toUpperCase()}`,
          isOwnYard: true,
          warrantySuggested: 90,
          conditionNotes: 'En patio propio. Verificado en banco de prueba. Cero fugas de aceite.',
        },
        {
          id: `CP-${Math.floor(1000 + Math.random() * 9000)}`,
          year: yr,
          make: mk,
          model: md,
          part: pt,
          title: `${yr} ${mk} ${md} - ${spec}`,
          description: `OEM TAKE-OFF, RUNNER 48K MI, CLEAN CYLINDER HEADS & OIL PAN`,
          partGrade: 'A',
          miles: 48200,
          price: 1550.0,
          dealerName: 'LKQ Heavy Truck & Auto Recyclers',
          dealerLocation: 'Richmond, VA',
          dealerPhone: '(804) 555-0142',
          distanceMiles: 118,
          stockNumber: `STK-LKQ-${Math.floor(10000 + Math.random() * 90000)}`,
          donorVin: `${yr}VIN${Math.random().toString(36).substring(2, 9).toUpperCase()}`,
          isOwnYard: false,
          warrantySuggested: 90,
          conditionNotes: 'Certificación de calidad LKQ con video de encendido previo.',
        },
        {
          id: `CP-${Math.floor(1000 + Math.random() * 9000)}`,
          year: yr,
          make: mk,
          model: md,
          part: pt,
          title: `${yr} ${mk} ${md} - ${pt}`,
          description: `GOOD RUNNER, 72K MI, 30-DAY EXCHANGE GUARANTEE INCLUDED`,
          partGrade: 'B',
          miles: 72100,
          price: 1280.0,
          dealerName: 'Carolina Auto Dismantlers',
          dealerLocation: 'Greensboro, NC',
          dealerPhone: '(336) 555-8711',
          distanceMiles: 65,
          stockNumber: `STK-CAD-${Math.floor(1000 + Math.random() * 9000)}`,
          donorVin: `${yr}VIN${Math.random().toString(36).substring(2, 9).toUpperCase()}`,
          isOwnYard: false,
          warrantySuggested: 60,
          conditionNotes: 'Ligero desgaste cosmético normal. Pruebas de fuga de compresión OK.',
        },
        {
          id: `CP-${Math.floor(1000 + Math.random() * 9000)}`,
          year: yr,
          make: mk,
          model: md,
          part: pt,
          title: `${yr} ${mk} ${md} - ${pt} High Mileage Economy`,
          description: `HIGH MILEAGE 115K MI, RUNS CLEAN, BUDGET FRIENDLY FOR REBUILD`,
          partGrade: 'C',
          miles: 115000,
          price: 890.0,
          dealerName: 'Apex Truck & Salvage Parts',
          dealerLocation: 'Charlotte, NC',
          dealerPhone: '(704) 555-3390',
          distanceMiles: 145,
          stockNumber: `STK-APX-${Math.floor(1000 + Math.random() * 9000)}`,
          donorVin: `${yr}VIN${Math.random().toString(36).substring(2, 9).toUpperCase()}`,
          isOwnYard: false,
          warrantySuggested: 30,
          conditionNotes: 'Precio económico. Se sugiere mantenimiento y retenes nuevos antes de montar.',
        },
      ];

      setResults(newResults);
      showToast(`✅ Búsqueda completada: 4 proveedores cotizados para ${mk} ${md}`);
    }, simulatedDelay);
  };

  // Convert CarPart to Prefilled Order
  const handleCreateOrder = (item: CarPartItem) => {
    // Determine suggested warranty days
    const warrantyDays = item.price >= 1500 ? 90 : item.price >= 1000 ? 60 : 30;

    const prefill: PrefillOrderData = {
      make: item.make,
      model: item.model,
      year: item.year,
      vin: item.donorVin || (searchMode === 'vin' ? vinInput : undefined),
      mainPart: item.part,
      productSpecs: `${item.title} | Millas: ${item.miles.toLocaleString()} mi | Grado: ${item.partGrade}`,
      stockNumber: item.stockNumber,
      partPrice: item.price,
      warrantyDays: warrantyDays,
      dealerName: item.dealerName,
      dealerPhone: item.dealerPhone,
      dealerLocation: item.dealerLocation,
      notes: `${item.description} - ${item.conditionNotes || ''}`,
    };

    onCreateOrderFromPart(prefill);
    showToast(`🚀 Abriendo formulario de orden con datos de ${item.dealerName}...`);
  };

  // Copy technical summary to clipboard
  const handleCopySummary = (item: CarPartItem) => {
    const text = `COTIZACIÓN CAR-PART / RADAR V2:\n• Pieza: ${item.title}\n• Millaje: ${item.miles.toLocaleString()} mi (Grade ${item.partGrade})\n• Precio Yarda: $${item.price.toFixed(2)} USD\n• Stock #: ${item.stockNumber}\n• Proveedor: ${item.dealerName} (${item.dealerLocation})\n• Teléfono: ${item.dealerPhone}\n• Garantía Sugerida: ${item.warrantySuggested} días\n• Notas: ${item.description}`;
    navigator.clipboard.writeText(text);
    showToast('📋 Ficha técnica copiada al portapapeles');
  };

  // Filtered & Sorted Results
  const filteredResults = React.useMemo(() => {
    let list = [...results];

    if (filterGrade !== 'all') {
      list = list.filter((r) => r.partGrade === filterGrade);
    }

    if (filterOwnYardOnly) {
      list = list.filter((r) => r.isOwnYard || r.dealerName.toLowerCase().includes('rodriguez'));
    }

    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase();
      list = list.filter(
        (r) =>
          r.title.toLowerCase().includes(q) ||
          r.dealerName.toLowerCase().includes(q) ||
          r.stockNumber.toLowerCase().includes(q) ||
          r.description.toLowerCase().includes(q)
      );
    }

    list.sort((a, b) => {
      if (sortBy === 'price_asc') return a.price - b.price;
      if (sortBy === 'miles_asc') return a.miles - b.miles;
      if (sortBy === 'distance_asc') return a.distanceMiles - b.distanceMiles;
      if (sortBy === 'grade_asc') return a.partGrade.localeCompare(b.partGrade);
      return 0;
    });

    return list;
  }, [results, filterGrade, filterOwnYardOnly, searchTerm, sortBy]);

  // Statistics Calculation
  const stats = React.useMemo(() => {
    if (results.length === 0) return { total: 0, avgPrice: 0, lowestMiles: 0, ownYardCount: 0 };
    const total = results.length;
    const avgPrice = results.reduce((acc, r) => acc + r.price, 0) / total;
    const lowestMiles = Math.min(...results.map((r) => r.miles));
    const ownYardCount = results.filter((r) => r.isOwnYard || r.dealerName.toLowerCase().includes('rodriguez')).length;
    return { total, avgPrice, lowestMiles, ownYardCount };
  }, [results]);

  // If Module is disabled globally and user is NOT admin
  if (!carpartEnabled && userRole !== 'admin') {
    return (
      <div className="max-w-4xl mx-auto my-12 bg-[#111827] border border-[#1e293b] rounded-2xl p-8 text-center flex flex-col items-center gap-4 shadow-2xl">
        <div className="w-16 h-16 rounded-2xl bg-[#ef4444]/15 border border-[#ef4444]/30 text-[#f87171] flex items-center justify-center">
          <span className="material-symbols-outlined text-[36px]">pause_circle</span>
        </div>
        <h2 className="text-2xl font-bold text-[#f1f5f9]">Módulo Buscar Piezas Pausado</h2>
        <p className="text-sm text-[#94a3b8] max-w-lg">
          La prospección de repuestos en Car-Part.com ha sido pausada temporalmente por la administración central de RADAR. Comunícate con un Super Administrador si requieres cotizar piezas de urgencia.
        </p>
      </div>
    );
  }

  return (
    <div className="w-full max-w-[1600px] mx-auto flex flex-col gap-6 animate-fade-in relative pb-12">
      {/* Toast Alert */}
      {toastMessage && (
        <div className="fixed top-20 right-6 z-50 bg-[#10b981] text-[#064e3b] font-bold text-xs py-2.5 px-4 rounded-xl shadow-[0_0_20px_rgba(16,185,129,0.4)] flex items-center gap-2 animate-bounce">
          <span className="material-symbols-outlined text-[18px]">check_circle</span>
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Amber Admin Warning if Module is Disabled globally */}
      {!carpartEnabled && userRole === 'admin' && (
        <div className="bg-[#f59e0b]/15 border border-[#f59e0b]/40 rounded-xl p-3.5 flex items-center justify-between gap-3 text-xs text-[#fbbf24]">
          <div className="flex items-center gap-2.5">
            <span className="material-symbols-outlined text-[#f59e0b] text-[20px]">warning</span>
            <span>
              <strong>Modo Pruebas (Super Admin):</strong> El módulo Buscar Piezas está desactivado para operadores generales en la configuración global.
            </span>
          </div>
          {onNavigateToSettings && (
            <button
              onClick={onNavigateToSettings}
              className="text-xs bg-[#f59e0b]/20 hover:bg-[#f59e0b]/30 text-[#fbbf24] px-3 py-1 rounded-lg border border-[#f59e0b]/40 font-bold transition-all cursor-pointer"
            >
              Configurar en /sistema
            </button>
          )}
        </div>
      )}

      {/* Top Header & Dual Architecture Status */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-[#111827]/80 p-5 rounded-2xl border border-[#1e293b] backdrop-blur-md">
        <div>
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-[#388bfd]/20 text-[#58a6ff] flex items-center justify-center border border-[#388bfd]/30 shadow-[0_0_15px_rgba(56,139,253,0.3)]">
              <span className="material-symbols-outlined text-[22px]">search_check</span>
            </div>
            <div>
              <h1 className="text-xl md:text-2xl font-black text-[#f1f5f9] tracking-tight flex items-center gap-2">
                <span>Buscar Piezas & VIN Decoder</span>
                <span className="text-xs font-mono bg-[#1e293b] text-[#94a3b8] px-2 py-0.5 rounded-full border border-[rgba(255,255,255,0.08)]">
                  Car-Part.com Pro
                </span>
              </h1>
              <p className="text-xs text-[#94a3b8]">
                Motor de prospección nacional en tiempo real, grados de calidad, millaje real y pre-llenado de órdenes con 1 clic.
              </p>
            </div>
          </div>
        </div>

        {/* Dual Architecture State Controls */}
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Extraction Mode Badge */}
          <div
            onClick={() => setExtractionMode(extractionMode === 'extension' ? 'backend' : 'extension')}
            className={`px-3.5 py-1.5 rounded-xl border flex items-center gap-2 text-xs font-bold cursor-pointer transition-all ${
              extractionMode === 'extension'
                ? 'bg-[#10b981]/15 border-[#10b981]/40 text-[#34d399] hover:bg-[#10b981]/25'
                : 'bg-[#6366f1]/15 border-[#6366f1]/40 text-[#a5b4fc] hover:bg-[#6366f1]/25'
            }`}
            title="Haz clic para alternar entre Extensión Local e IP Backend"
          >
            <span
              className={`w-2.5 h-2.5 rounded-full ${
                extractionMode === 'extension' ? 'bg-[#10b981] animate-pulse shadow-[0_0_8px_#10b981]' : 'bg-[#6366f1]'
              }`}
            />
            <span>
              {extractionMode === 'extension'
                ? '⚡ Extensión Local Conectada (IP Residencial)'
                : '🛡️ Motor Backend de Respaldo (Puppeteer Stealth VPS)'}
            </span>
          </div>

          {/* Chrome Extension Modal Trigger */}
          <button
            onClick={() => setIsExtensionModalOpen(true)}
            className="bg-[#1c2438] hover:bg-[#25324d] text-[#cbd5e1] hover:text-white border border-[#2b3a58] px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer"
          >
            <span className="material-symbols-outlined text-[16px] text-[#58a6ff]">extension</span>
            <span>Extensión Chrome</span>
          </button>
        </div>
      </div>

      {/* Main Layout: Left Search Form + Right Results & Analytics */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Search Form Card */}
        <div className="lg:col-span-4 flex flex-col gap-4">
          <div className="bg-[#0f172a] border border-[#1e293b] rounded-2xl p-5 shadow-xl flex flex-col gap-4">
            {/* Search Mode Tabs */}
            <div className="flex items-center justify-between border-b border-[#1e293b] pb-3">
              <span className="text-xs font-bold text-[#94a3b8] uppercase tracking-wider">Modo de Consulta</span>
              <div className="grid grid-cols-2 gap-1 bg-[#090d16] p-1 rounded-xl border border-[#1e293b]">
                <button
                  type="button"
                  onClick={() => setSearchMode('vin')}
                  className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    searchMode === 'vin'
                      ? 'bg-[#388bfd] text-white shadow-sm'
                      : 'text-[#94a3b8] hover:text-white'
                  }`}
                >
                  ⚡ Por VIN
                </button>
                <button
                  type="button"
                  onClick={() => setSearchMode('vehicle')}
                  className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    searchMode === 'vehicle'
                      ? 'bg-[#388bfd] text-white shadow-sm'
                      : 'text-[#94a3b8] hover:text-white'
                  }`}
                >
                  🚗 Por Vehículo
                </button>
              </div>
            </div>

            {/* Mode A: VIN Search Form */}
            {searchMode === 'vin' && (
              <div className="flex flex-col gap-3.5">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-bold text-[#f1f5f9]">Número de Serie (VIN)</label>
                    <span className="text-[11px] font-mono text-[#94a3b8]">
                      {vinInput.length}/17 caracteres
                    </span>
                  </div>
                  <div className="relative">
                    <input
                      type="text"
                      maxLength={17}
                      value={vinInput}
                      onChange={(e) => setVinInput(e.target.value.toUpperCase())}
                      placeholder="Ej. 1FTEW1EP5KFB81920"
                      className="w-full bg-[#090d16] border border-[#2b3a58] rounded-xl py-2 pl-3 pr-8 font-mono text-sm text-[#58a6ff] font-bold tracking-wider focus:outline-none focus:border-[#388bfd] uppercase"
                    />
                    {vinInput.length === 17 && (
                      <span className="material-symbols-outlined text-[#10b981] text-[18px] absolute right-2.5 top-1/2 -translate-y-1/2">
                        check_circle
                      </span>
                    )}
                  </div>
                </div>

                {/* Live Decoded VIN Card */}
                {decodedVinInfo && (
                  <div className="bg-[#13233c]/60 border border-[#388bfd]/30 rounded-xl p-3 flex flex-col gap-1 text-xs">
                    <div className="flex items-center justify-between text-[#58a6ff] font-bold">
                      <span className="flex items-center gap-1">
                        <span className="material-symbols-outlined text-[15px]">directions_car</span>
                        {decodedVinInfo.year} {decodedVinInfo.make} {decodedVinInfo.model}
                      </span>
                      <span className="text-[10px] bg-[#388bfd]/20 px-2 py-0.5 rounded text-[#93c5fd]">
                        Auto-decodificado
                      </span>
                    </div>
                    <p className="text-[11px] text-[#cbd5e1]">{decodedVinInfo.engine}</p>
                  </div>
                )}

                {/* Sample VIN Chips */}
                <div>
                  <label className="text-[11px] text-[#94a3b8] block mb-1.5 font-semibold">
                    VINs de Prueba Rápida:
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {SAMPLE_VINS.map((sample) => (
                      <button
                        key={sample.vin}
                        type="button"
                        onClick={() => setVinInput(sample.vin)}
                        className={`text-[10px] px-2 py-1 rounded-lg border font-mono transition-all cursor-pointer ${
                          vinInput === sample.vin
                            ? 'bg-[#388bfd]/25 border-[#388bfd] text-[#58a6ff] font-bold'
                            : 'bg-[#1e293b]/60 border-[#2b3a58] text-[#94a3b8] hover:text-white'
                        }`}
                      >
                        {sample.make} {sample.model}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Mode B: Manual Vehicle Cascade */}
            {searchMode === 'vehicle' && (
              <div className="flex flex-col gap-3">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs font-semibold text-[#cbd5e1] block mb-1">Año</label>
                    <select
                      value={vehicleYear}
                      onChange={(e) => setVehicleYear(parseInt(e.target.value))}
                      className="w-full bg-[#090d16] border border-[#2b3a58] rounded-xl p-2 text-xs text-[#f1f5f9] focus:outline-none focus:border-[#388bfd]"
                    >
                      {Array.from({ length: 37 }, (_, i) => 2026 - i).map((y) => (
                        <option key={y} value={y}>
                          {y}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-[#cbd5e1] block mb-1">Marca</label>
                    <select
                      value={vehicleMake}
                      onChange={(e) => handleMakeChange(e.target.value)}
                      className="w-full bg-[#090d16] border border-[#2b3a58] rounded-xl p-2 text-xs text-[#f1f5f9] focus:outline-none focus:border-[#388bfd]"
                    >
                      {Object.keys(MAKE_MODEL_MAP).map((mk) => (
                        <option key={mk} value={mk}>
                          {mk}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="text-xs font-semibold text-[#cbd5e1] block mb-1">
                    Modelo (Cascada Dinámica)
                  </label>
                  <select
                    value={vehicleModel}
                    onChange={(e) => setVehicleModel(e.target.value)}
                    className="w-full bg-[#090d16] border border-[#2b3a58] rounded-xl p-2 text-xs text-[#f1f5f9] focus:outline-none focus:border-[#388bfd]"
                  >
                    {(MAKE_MODEL_MAP[vehicleMake] || []).map((md) => (
                      <option key={md} value={md}>
                        {md}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            {/* Common Fields: Part Type & Zipcode */}
            <div className="flex flex-col gap-3 pt-2 border-t border-[#1e293b]">
              <div>
                <label className="text-xs font-bold text-[#f1f5f9] block mb-1">Tipo de Pieza a Cotizar</label>
                <select
                  value={selectedPart}
                  onChange={(e) => setSelectedPart(e.target.value)}
                  className="w-full bg-[#090d16] border border-[#2b3a58] rounded-xl p-2 text-xs text-[#58a6ff] font-bold focus:outline-none focus:border-[#388bfd]"
                >
                  {POPULAR_PARTS.map((pt) => (
                    <option key={pt} value={pt}>
                      {pt}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs font-semibold text-[#cbd5e1] block mb-1">
                  Código Postal Base (Cálculo de Distancia)
                </label>
                <input
                  type="text"
                  value={zipcode}
                  onChange={(e) => setZipcode(e.target.value)}
                  placeholder="27520"
                  className="w-full bg-[#090d16] border border-[#2b3a58] rounded-xl p-2 font-mono text-xs text-[#f1f5f9] focus:outline-none focus:border-[#388bfd]"
                />
              </div>
            </div>

            {/* Submit Button */}
            <button
              type="button"
              disabled={isSearching}
              onClick={() => handleExecuteSearch(false)}
              className="w-full mt-2 py-3 px-4 rounded-xl bg-[#388bfd] hover:bg-[#2b79e2] disabled:bg-[#1e293b] disabled:text-[#64748b] text-white font-bold text-sm shadow-[0_0_15px_rgba(56,139,253,0.4)] transition-all cursor-pointer flex items-center justify-center gap-2 active:scale-95"
            >
              {isSearching ? (
                <>
                  <span className="material-symbols-outlined text-[20px] animate-spin">
                    progress_activity
                  </span>
                  <span>Consultando Car-Part.com...</span>
                </>
              ) : (
                <>
                  <span className="material-symbols-outlined text-[20px]">manage_search</span>
                  <span>Buscar Piezas en Car-Part</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Right Column: Statistics + Toolbar + Results Grid */}
        <div className="lg:col-span-8 flex flex-col gap-4">
          {/* Quick Stats Summary Bar */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-[#0f172a] border border-[#1e293b] rounded-xl p-3.5 flex flex-col">
              <span className="text-[11px] font-bold text-[#94a3b8] uppercase">Proveedores</span>
              <span className="text-xl font-mono font-bold text-[#58a6ff] mt-0.5">
                {stats.total} Yardas
              </span>
            </div>

            <div className="bg-[#0f172a] border border-[#1e293b] rounded-xl p-3.5 flex flex-col">
              <span className="text-[11px] font-bold text-[#94a3b8] uppercase">Precio Promedio</span>
              <span className="text-xl font-mono font-bold text-[#f1f5f9] mt-0.5">
                ${stats.avgPrice.toFixed(0)} USD
              </span>
            </div>

            <div className="bg-[#0f172a] border border-[#1e293b] rounded-xl p-3.5 flex flex-col">
              <span className="text-[11px] font-bold text-[#94a3b8] uppercase">Menor Millaje</span>
              <span className="text-xl font-mono font-bold text-[#34d399] mt-0.5">
                {stats.lowestMiles ? `${stats.lowestMiles.toLocaleString()} mi` : '0 mi'}
              </span>
            </div>

            <div className="bg-[#0f172a] border border-[#1e293b] rounded-xl p-3.5 flex flex-col">
              <span className="text-[11px] font-bold text-[#94a3b8] uppercase">En Patio Propio</span>
              <span className="text-xl font-mono font-bold text-[#10b981] mt-0.5">
                ⭐ {stats.ownYardCount} Lote
              </span>
            </div>
          </div>

          {/* Filter Toolbar */}
          <div className="bg-[#0f172a] border border-[#1e293b] rounded-xl p-3.5 flex flex-wrap items-center justify-between gap-3">
            {/* Left Filter Controls */}
            <div className="flex flex-wrap items-center gap-2">
              {/* Grade Filter Pills */}
              <div className="flex items-center gap-1 bg-[#090d16] p-1 rounded-xl border border-[#1e293b]">
                {(['all', 'A', 'B', 'C'] as const).map((g) => (
                  <button
                    key={g}
                    type="button"
                    onClick={() => setFilterGrade(g)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                      filterGrade === g
                        ? 'bg-[#388bfd] text-white shadow-sm'
                        : 'text-[#94a3b8] hover:text-white'
                    }`}
                  >
                    {g === 'all' ? 'Todos' : `Grado ${g}`}
                  </button>
                ))}
              </div>

              {/* Own Yard Toggle */}
              <button
                type="button"
                onClick={() => setFilterOwnYardOnly(!filterOwnYardOnly)}
                className={`px-3 py-1.5 rounded-xl border text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
                  filterOwnYardOnly
                    ? 'bg-[#10b981]/25 border-[#10b981] text-[#34d399]'
                    : 'bg-[#090d16] border-[#1e293b] text-[#94a3b8] hover:text-white'
                }`}
              >
                <span>⭐ Solo Rodriguez Yard</span>
              </button>
            </div>

            {/* Right Sorting & Search Filter */}
            <div className="flex items-center gap-2 w-full sm:w-auto">
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as any)}
                className="bg-[#090d16] border border-[#2b3a58] rounded-xl px-2.5 py-1.5 text-xs text-[#cbd5e1] font-semibold focus:outline-none"
              >
                <option value="price_asc">Ordenar: Menor Precio</option>
                <option value="miles_asc">Ordenar: Menor Millaje</option>
                <option value="distance_asc">Ordenar: Menor Distancia</option>
                <option value="grade_asc">Ordenar: Mejor Grado</option>
              </select>

              <div className="relative flex-1 sm:w-44">
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Filtrar..."
                  className="w-full bg-[#090d16] border border-[#2b3a58] rounded-xl py-1.5 pl-3 pr-7 text-xs text-[#f1f5f9] focus:outline-none"
                />
                {searchTerm && (
                  <button
                    onClick={() => setSearchTerm('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-[#94a3b8] hover:text-white text-xs"
                  >
                    ×
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Results List */}
          <div className="flex flex-col gap-4">
            {searchTiming && (
              <div className="text-[11px] text-[#94a3b8] flex items-center justify-between px-1">
                <span>
                  Mostrando {filteredResults.length} resultados encontrados vía{' '}
                  <strong className="text-[#58a6ff]">
                    {extractionMode === 'extension' ? 'Extensión Local (IP Residencial)' : 'Puppeteer VPS'}
                  </strong>
                </span>
                <span className="font-mono text-[#10b981]">Latencia: {searchTiming}s</span>
              </div>
            )}

            {filteredResults.length === 0 ? (
              <div className="bg-[#0f172a] border border-[#1e293b] rounded-2xl p-12 text-center flex flex-col items-center gap-3">
                <span className="material-symbols-outlined text-[42px] text-[#64748b]">
                  inventory_2
                </span>
                <h3 className="text-base font-bold text-[#cbd5e1]">No hay resultados con los filtros actuales</h3>
                <p className="text-xs text-[#94a3b8] max-w-md">
                  Intenta cambiar los filtros de grado, distancia o ejecuta una nueva búsqueda por VIN.
                </p>
              </div>
            ) : (
              filteredResults.map((item) => (
                <div
                  key={item.id}
                  className={`rounded-2xl p-5 transition-all shadow-lg flex flex-col gap-4 relative ${
                    item.isOwnYard || item.dealerName.toLowerCase().includes('rodriguez')
                      ? 'bg-[#06241a]/60 border-2 border-[#10b981] shadow-[0_0_20px_rgba(16,185,129,0.15)]'
                      : 'bg-[#0f172a] border border-[#1e293b] hover:border-[#388bfd]/50'
                  }`}
                >
                  {/* Top Bar inside Card */}
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                    <div className="flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        {/* Own Yard Badge */}
                        {(item.isOwnYard || item.dealerName.toLowerCase().includes('rodriguez')) && (
                          <span className="bg-[#10b981] text-[#042f20] px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider flex items-center gap-1 shadow-sm">
                            ⭐ En Patio Propio (Rodriguez Yard)
                          </span>
                        )}

                        {/* Part Grade Badge */}
                        <span
                          className={`px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider border ${
                            item.partGrade === 'A'
                              ? 'bg-[#10b981]/20 border-[#10b981] text-[#34d399]'
                              : item.partGrade === 'B'
                              ? 'bg-[#388bfd]/20 border-[#388bfd] text-[#58a6ff]'
                              : 'bg-[#f59e0b]/20 border-[#f59e0b] text-[#fbbf24]'
                          }`}
                        >
                          Grade {item.partGrade}
                        </span>

                        {/* Stock Number */}
                        <span className="font-mono text-xs text-[#94a3b8] bg-[#090d16] px-2 py-0.5 rounded border border-[#1e293b]">
                          Stock #{item.stockNumber}
                        </span>

                        {/* Suggested Warranty */}
                        <span className="text-[10px] font-mono bg-[#8b5cf6]/20 border border-[#8b5cf6]/40 text-[#c084fc] px-2 py-0.5 rounded-full font-bold">
                          Garantía Sugerida: {item.warrantySuggested} Días
                        </span>
                      </div>

                      <h3 className="text-base font-bold text-[#f1f5f9] mt-2">
                        {item.title}
                      </h3>
                      <p className="text-xs text-[#94a3b8] font-mono mt-0.5">
                        {item.description}
                      </p>
                    </div>

                    {/* Price in USD */}
                    <div className="flex flex-col sm:items-end">
                      <span className="text-2xl font-black font-mono text-[#58a6ff] drop-shadow-[0_0_12px_rgba(56,139,253,0.5)]">
                        ${item.price.toFixed(2)}
                      </span>
                      <span className="text-[10px] text-[#94a3b8]">Precio Cotizado USD</span>
                    </div>
                  </div>

                  {/* Donor Car Specs & Dealer Details Bar */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-[#090d16]/80 p-3 rounded-xl border border-[#1e293b] text-xs">
                    <div>
                      <span className="text-[10px] text-[#94a3b8] block">Odómetro / Millaje</span>
                      <strong className="text-[#34d399] font-mono flex items-center gap-1 mt-0.5">
                        <span className="material-symbols-outlined text-[14px]">bolt</span>
                        {item.miles.toLocaleString()} mi
                      </strong>
                    </div>

                    <div>
                      <span className="text-[10px] text-[#94a3b8] block">Proveedor / Yarda</span>
                      <strong className="text-[#f1f5f9] truncate block mt-0.5">
                        {item.dealerName}
                      </strong>
                    </div>

                    <div>
                      <span className="text-[10px] text-[#94a3b8] block">Ubicación & Distancia</span>
                      <span className="text-[#cbd5e1] font-mono flex items-center gap-1 mt-0.5">
                        <span className="material-symbols-outlined text-[14px] text-[#58a6ff]">
                          location_on
                        </span>
                        {item.dealerLocation} ({item.distanceMiles} mi)
                      </span>
                    </div>

                    <div>
                      <span className="text-[10px] text-[#94a3b8] block">Teléfono Proveedor</span>
                      <a
                        href={`tel:${item.dealerPhone}`}
                        className="text-[#58a6ff] hover:underline font-mono font-bold flex items-center gap-1 mt-0.5"
                      >
                        <span className="material-symbols-outlined text-[14px]">call</span>
                        {item.dealerPhone}
                      </a>
                    </div>
                  </div>

                  {/* Actions Footer */}
                  <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                    <div className="text-[11px] text-[#94a3b8] flex items-center gap-2">
                      <span className="material-symbols-outlined text-[16px] text-[#10b981]">
                        verified
                      </span>
                      <span>{item.conditionNotes || 'Inspección técnica disponible'}</span>
                    </div>

                    <div className="flex items-center gap-2 w-full sm:w-auto">
                      <button
                        type="button"
                        onClick={() => handleCopySummary(item)}
                        className="flex-1 sm:flex-none px-3 py-2 rounded-xl bg-[#1e293b] hover:bg-[#2b3a58] text-[#cbd5e1] hover:text-white text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                      >
                        <span className="material-symbols-outlined text-[16px]">content_copy</span>
                        <span>Copiar Ficha</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleCreateOrder(item)}
                        className="flex-1 sm:flex-none px-4 py-2 rounded-xl bg-[#388bfd] hover:bg-[#2b79e2] text-white text-xs font-bold shadow-[0_0_15px_rgba(56,139,253,0.4)] transition-all flex items-center justify-center gap-1.5 cursor-pointer active:scale-95"
                      >
                        <span className="material-symbols-outlined text-[16px]">add_shopping_cart</span>
                        <span>Crear Orden desde esta Pieza</span>
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Intermediate Selection Modal */}
      {intermediateModalData.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in">
          <div className="bg-[#111827] border border-[#2b3a58] rounded-2xl w-full max-w-xl shadow-2xl flex flex-col overflow-hidden">
            <div className="p-5 bg-[#182338] border-b border-[#2b3a58] flex justify-between items-center">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-[#f59e0b]/20 text-[#fbbf24] flex items-center justify-center border border-[#f59e0b]/40">
                  <span className="material-symbols-outlined text-[18px]">alt_route</span>
                </div>
                <div>
                  <h3 className="font-bold text-base text-[#f1f5f9]">
                    Opciones Intermedias Detectadas
                  </h3>
                  <p className="text-xs text-[#94a3b8]">
                    Selecciona la variante técnica exacta requerida por el cliente
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIntermediateModalData({ isOpen: false, title: '', options: [] })}
                className="text-[#94a3b8] hover:text-white p-1"
              >
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            <div className="p-6 flex flex-col gap-3 max-h-[60vh] overflow-y-auto custom-scrollbar">
              <p className="text-xs text-[#cbd5e1] mb-1">
                Car-Part.com identificó múltiples configuraciones de motor/caja para este modelo:
              </p>
              {intermediateModalData.options.map((opt) => (
                <button
                  key={opt.id}
                  onClick={() => {
                    setIntermediateModalData({ isOpen: false, title: '', options: [] });
                    handleExecuteSearch(true, opt.title);
                  }}
                  className="bg-[#0f172a] hover:bg-[#1e293b] border border-[#1e293b] hover:border-[#388bfd] rounded-xl p-4 text-left transition-all group flex flex-col gap-1 cursor-pointer"
                >
                  <div className="flex items-center justify-between">
                    <strong className="text-xs text-[#58a6ff] group-hover:text-[#93c5fd] font-bold">
                      {opt.title}
                    </strong>
                    <span className="material-symbols-outlined text-[18px] text-[#94a3b8] group-hover:text-[#388bfd]">
                      arrow_forward
                    </span>
                  </div>
                  <p className="text-xs text-[#94a3b8]">{opt.description}</p>
                  <span className="font-mono text-[10px] text-[#34d399] mt-1">
                    Specs: {opt.specs}
                  </span>
                </button>
              ))}
            </div>

            <div className="p-4 bg-[#0d131f] border-t border-[#1e293b] flex justify-end">
              <button
                onClick={() => setIntermediateModalData({ isOpen: false, title: '', options: [] })}
                className="px-4 py-2 rounded-xl bg-[#1e293b] hover:bg-[#2b3a58] text-[#cbd5e1] text-xs font-bold transition-all"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Chrome Extension Modal */}
      {isExtensionModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in">
          <div className="bg-[#111827] border border-[#2b3a58] rounded-2xl w-full max-w-lg shadow-2xl flex flex-col overflow-hidden">
            <div className="p-5 bg-[#182338] border-b border-[#2b3a58] flex justify-between items-center">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-[#10b981]/20 text-[#34d399] flex items-center justify-center border border-[#10b981]/40">
                  <span className="material-symbols-outlined text-[18px]">extension</span>
                </div>
                <div>
                  <h3 className="font-bold text-base text-[#f1f5f9]">
                    Extensión de Chrome RADAR
                  </h3>
                  <p className="text-xs text-[#94a3b8]">
                    Scraping de alta velocidad con IP Residencial
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsExtensionModalOpen(false)}
                className="text-[#94a3b8] hover:text-white p-1"
              >
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            <div className="p-6 flex flex-col gap-4 text-xs text-[#cbd5e1]">
              <div className="bg-[#10b981]/10 border border-[#10b981]/30 rounded-xl p-3.5 flex items-start gap-2.5">
                <span className="material-symbols-outlined text-[#10b981] text-[20px] shrink-0 mt-0.5">
                  bolt
                </span>
                <p className="text-xs text-[#a7f3d0]">
                  Al usar la extensión de Chrome, tus consultas viajan directamente desde la conexión local de tu ordenador a Car-Part.com, evitando bloqueos por Cloudflare y respondiendo en menos de 3 segundos.
                </p>
              </div>

              <h4 className="font-bold text-sm text-[#f1f5f9] mt-1">Guía de Instalación en 3 Pasos:</h4>
              <ol className="list-decimal pl-5 flex flex-col gap-2">
                <li>
                  Descarga el paquete comprimido <strong className="text-[#58a6ff]">radar-carpart-extension.zip</strong>.
                </li>
                <li>
                  Abre en Chrome: <code className="bg-[#090d16] px-2 py-0.5 rounded font-mono text-[#f1f5f9]">chrome://extensions</code> y activa el <strong>Modo de desarrollador</strong> en la esquina superior derecha.
                </li>
                <li>
                  Arrastra la carpeta descomprimida o pulsa <strong>"Cargar descomprimida"</strong>.
                </li>
              </ol>

              <div className="pt-2">
                <button
                  type="button"
                  onClick={() => {
                    showToast('📦 Descargando radar-carpart-extension.zip...');
                    setIsExtensionModalOpen(false);
                  }}
                  className="w-full py-2.5 rounded-xl bg-[#10b981] hover:bg-[#059669] text-[#064e3b] font-bold text-xs shadow-lg transition-all flex items-center justify-center gap-2 cursor-pointer"
                >
                  <span className="material-symbols-outlined text-[18px]">download</span>
                  <span>Descargar Extensión (.ZIP)</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
