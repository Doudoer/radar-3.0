import React, { useState, useEffect, useMemo } from 'react';
import { Order, OrderStatus, PrefillOrderData, Customer } from '../types';
import { MAKE_MODEL_MAP } from '../data/vehicleData';

interface NewOrderModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreateOrder: (newOrder: Order) => void;
  onUpdateOrder?: (order: Order) => void;
  editingOrder?: Order | null;
  initialPrefillData?: PrefillOrderData | null;
  existingCustomers?: Customer[];
}

export const NewOrderModal: React.FC<NewOrderModalProps> = ({
  isOpen,
  onClose,
  onCreateOrder,
  onUpdateOrder,
  editingOrder,
  initialPrefillData,
  existingCustomers = [],
}) => {
  // Stepper State (1: Vehículo & Pieza, 2: Datos del Cliente, 3: Finanzas & Envío)
  const [currentStep, setCurrentStep] = useState<number>(1);
  const [stepError, setStepError] = useState<string | null>(null);

  // 1. Customer Dimensions & CRM Selection State
  const [clientMode, setClientMode] = useState<'search' | 'manual'>('search');
  const [clientSearchQuery, setClientSearchQuery] = useState('');
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState<string>('all');
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);

  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [customerType, setCustomerType] = useState<'Particular' | 'Empresa' | 'Flota Mantenimiento' | 'VIP' | 'Taller Mecánico'>('Particular');
  const [shippingAddress, setShippingAddress] = useState('');
  const [zipCode, setZipCode] = useState('27520');
  const [showAddressDetails, setShowAddressDetails] = useState(true);

  // 2. Vehicle Dimensions
  const [vehicleMake, setVehicleMake] = useState('');
  const [vehicleModel, setVehicleModel] = useState('');
  const [vehicleYear, setVehicleYear] = useState<number | ''>('');
  const [vehicleTransmission, setVehicleTransmission] = useState('');
  const [vehicleVIN, setVehicleVIN] = useState('');
  const [vinDecodeStatus, setVinDecodeStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [vinDecodeMessage, setVinDecodeMessage] = useState('');
  const [vehicleMileage, setVehicleMileage] = useState('0');
  const [vehicleColor, setVehicleColor] = useState('Gris Grafito');

  // 3. Part & Yard Dimensions
  const [mainPart, setMainPart] = useState('');
  const [productSpecs, setProductSpecs] = useState('');
  const [stockNumber, setStockNumber] = useState('');
  const [notes, setNotes] = useState('');

  // 4. Financial Dimensions & Equations
  const [partPrice, setPartPrice] = useState('');
  const [downPayment, setDownPayment] = useState('');
  const [deliveryFee, setDeliveryFee] = useState('');
  const [coreFee, setCoreFee] = useState('');
  const [deliveryType, setDeliveryType] = useState<'retiro_tienda' | 'envio_domicilio'>('retiro_tienda');

  // 5. Warranty & Workflow
  const [warrantyDays, setWarrantyDays] = useState(30);
  const [status, setStatus] = useState<OrderStatus>('cotizacion');
  const [advisor, setAdvisor] = useState('Carlos Mendoza (Ventas)');

  const yearOptions = useMemo(
    () => Array.from({ length: 37 }, (_, index) => 2026 - index),
    []
  );
  const makeOptions = useMemo(() => Object.keys(MAKE_MODEL_MAP).sort(), []);
  const modelOptions = useMemo(
    () => (vehicleYear !== '' && vehicleMake ? MAKE_MODEL_MAP[vehicleMake] || [] : []),
    [vehicleYear, vehicleMake]
  );
  const resolveCatalogMake = (make: string) =>
    makeOptions.find((option) => option.toLowerCase() === make.toLowerCase()) || make;

  const normalizePartType = (value?: string): 'Engine' | 'Transmission' =>
    /transmi|transmission|gearbox|caja de cambios/i.test(value || '') ? 'Transmission' : 'Engine';

  // Calculate Warranty Days automatically based on price
  const calculateAutoWarranty = (priceNum: number): number => {
    if (priceNum >= 1500) return 90;
    if (priceNum >= 1000) return 60;
    return 30;
  };

  // Filtered Customers for Step 2 CRM Selector
  const filteredCustomers = useMemo(() => {
    return existingCustomers.filter((cust) => {
      // Category filter
      if (selectedCategoryFilter !== 'all' && cust.type !== selectedCategoryFilter) {
        return false;
      }
      // Query filter
      if (!clientSearchQuery.trim()) return true;
      const q = clientSearchQuery.toLowerCase();
      const name = (cust.name || `${cust.first_name || ''} ${cust.last_name || ''}`).toLowerCase();
      const company = (cust.company || '').toLowerCase();
      const phone = (cust.phone || cust.whatsapp || '').toLowerCase();
      const email = (cust.email || '').toLowerCase();
      const loc = (cust.shippingAddress || cust.address_shipping || cust.location || '').toLowerCase();
      const id = cust.id.toLowerCase();
      return (
        name.includes(q) ||
        company.includes(q) ||
        phone.includes(q) ||
        email.includes(q) ||
        loc.includes(q) ||
        id.includes(q)
      );
    });
  }, [existingCustomers, selectedCategoryFilter, clientSearchQuery]);

  // Selected customer object
  const selectedCustomerObj = useMemo(() => {
    if (!selectedCustomerId) return null;
    return existingCustomers.find((c) => c.id === selectedCustomerId) || null;
  }, [existingCustomers, selectedCustomerId]);

  const handleSelectCustomer = (customer: Customer) => {
    setSelectedCustomerId(customer.id);
    const fullName = customer.name || `${customer.first_name || ''} ${customer.last_name || ''}`.trim();
    setCustomerName(fullName);
    setCustomerPhone(customer.phone || customer.whatsapp || '');
    setCustomerEmail(customer.email || '');
    setCustomerType(customer.type || 'Particular');
    setShippingAddress(customer.shippingAddress || customer.address_shipping || customer.location || '');
    setZipCode(customer.zip_code || '27520');
    setStepError(null);
  };

  const handleClearCustomerSelection = () => {
    setSelectedCustomerId(null);
    setCustomerName('');
    setCustomerPhone('');
    setCustomerEmail('');
    setCustomerType('Particular');
    setShippingAddress('');
    setZipCode('27520');
  };

  const handleManualYearChange = (value: string) => {
    setVehicleYear(value ? Number(value) : '');
    setVehicleMake('');
    setVehicleModel('');
    if (stepError) setStepError(null);
  };

  const handleManualMakeChange = (value: string) => {
    setVehicleMake(value);
    setVehicleModel('');
    if (stepError) setStepError(null);
  };

  const decodeVin = async (vin: string) => {
    const normalizedVin = vin.trim().toUpperCase();
    if (normalizedVin.length !== 17) {
      setVinDecodeStatus('idle');
      setVinDecodeMessage('');
      return;
    }

    setVinDecodeStatus('loading');
    setVinDecodeMessage('Consultando NHTSA...');
    try {
      const response = await fetch(
        `https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValuesExtended/${encodeURIComponent(normalizedVin)}?format=json`
      );
      if (!response.ok) throw new Error('NHTSA no respondió');
      const payload = await response.json();
      const result = payload.Results?.[0];
      if (!result || result.ErrorCode === '1' || (!result.Make && !result.Model)) {
        throw new Error('VIN no encontrado');
      }

      if (result.Make) setVehicleMake(resolveCatalogMake(result.Make));
      if (result.Model) setVehicleModel(result.Model);
      if (result.ModelYear && /^\d{4}$/.test(result.ModelYear)) setVehicleYear(Number(result.ModelYear));
      if (result.TransmissionStyle) setVehicleTransmission(result.TransmissionStyle);
      setVinDecodeStatus('success');
      setVinDecodeMessage('Datos del vehículo actualizados desde NHTSA');
    } catch {
      setVinDecodeStatus('error');
      setVinDecodeMessage('No se pudo decodificar este VIN');
    }
  };

  // Handle Prefill from Car-Part Scraper, Call Center or CRM
  useEffect(() => {
    if (editingOrder && isOpen) {
      setCurrentStep(1);
      setSelectedCustomerId(editingOrder.customer.id || null);
      setCustomerName(editingOrder.customer.name);
      setCustomerPhone(editingOrder.customer.phone || '');
      setCustomerEmail(editingOrder.customer.email || '');
      setCustomerType(editingOrder.customer.type || 'Particular');
      setShippingAddress(editingOrder.customer.shippingAddress || editingOrder.customer.address_shipping || '');
      setZipCode(editingOrder.customer.zip_code || '27520');
      setVehicleMake(editingOrder.vehicle.make || 'Ford');
      setVehicleModel(editingOrder.vehicle.model || 'F-150');
      setVehicleYear(editingOrder.vehicle.year || 2023);
      setVehicleTransmission(editingOrder.vehicle.transmission || '');
      setVehicleVIN(editingOrder.vehicle.vin || '');
      setVehicleMileage(editingOrder.vehicle.mileage || '0');
      setVehicleColor(editingOrder.vehicle.color || '');
      setMainPart(normalizePartType(editingOrder.mainPart));
      setProductSpecs(editingOrder.productSpecs || '');
      setStockNumber(editingOrder.stockNumber || '');
      setNotes(editingOrder.notes || '');
      setPartPrice(String(editingOrder.financials.partPrice ?? editingOrder.financials.baseMSRP ?? 0));
      setDownPayment(String(editingOrder.financials.downPayment ?? editingOrder.financials.advancePayment ?? 0));
      setDeliveryFee(String(editingOrder.financials.deliveryFee ?? 0));
      setCoreFee(String(editingOrder.financials.coreFee ?? 0));
      setDeliveryType(editingOrder.deliveryType || 'retiro_tienda');
      setWarrantyDays(editingOrder.warrantyDays || 60);
      setStatus(editingOrder.status);
      setAdvisor(editingOrder.advisor || '');
      setStepError(null);
    } else if (initialPrefillData && isOpen) {
      if (initialPrefillData.make) setVehicleMake(initialPrefillData.make);
      if (initialPrefillData.model) setVehicleModel(initialPrefillData.model);
      if (initialPrefillData.year) setVehicleYear(initialPrefillData.year);
      if (initialPrefillData.vin) setVehicleVIN(initialPrefillData.vin);
      if (initialPrefillData.mainPart) setMainPart(normalizePartType(initialPrefillData.mainPart));
      if (initialPrefillData.productSpecs) setProductSpecs(initialPrefillData.productSpecs);
      if (initialPrefillData.stockNumber) setStockNumber(initialPrefillData.stockNumber);
      
      if (initialPrefillData.partPrice !== undefined) {
        const priceStr = initialPrefillData.partPrice.toString();
        setPartPrice(priceStr);
        const autoDays = calculateAutoWarranty(initialPrefillData.partPrice);
        setWarrantyDays(initialPrefillData.warrantyDays || autoDays);
      }
      
      // Customer prefill if passed
      if (initialPrefillData.customerName) {
        setCustomerName(initialPrefillData.customerName);
        // Try to match with existing customer
        const match = existingCustomers.find(
          (c) => c.name.toLowerCase() === initialPrefillData.customerName?.toLowerCase()
        );
        if (match) {
          setSelectedCustomerId(match.id);
        }
      }
      if (initialPrefillData.customerPhone) setCustomerPhone(initialPrefillData.customerPhone);
      if (initialPrefillData.customerEmail) setCustomerEmail(initialPrefillData.customerEmail);
      if (initialPrefillData.customerType) setCustomerType(initialPrefillData.customerType);
      if (initialPrefillData.customerAddress) setShippingAddress(initialPrefillData.customerAddress);
      if (initialPrefillData.customerZipCode) setZipCode(initialPrefillData.customerZipCode);

      const supplierNotes = initialPrefillData.dealerName 
        ? `Cotizado vía Car-Part: ${initialPrefillData.dealerName} (${initialPrefillData.dealerLocation || ''}) Tel: ${initialPrefillData.dealerPhone || ''}. ${initialPrefillData.notes || ''}`
        : initialPrefillData.notes || '';
      if (supplierNotes) setNotes(supplierNotes);

      // Si viene de car-part y ya tiene cliente, o datos de pieza, mantener en paso 1
      setCurrentStep(1);
    } else if (isOpen) {
      setCurrentStep(1);
      setStepError(null);
      setVehicleMake('');
      setVehicleModel('');
      setVehicleYear('');
      setVehicleTransmission('');
      setVehicleVIN('');
      setVinDecodeStatus('idle');
      setVinDecodeMessage('');
      setVehicleMileage('0');
      setMainPart('');
      setProductSpecs('');
      setStockNumber('');
      setNotes('');
      setPartPrice('');
      setDownPayment('');
      setDeliveryFee('');
      setCoreFee('');
      setDeliveryType('retiro_tienda');
      setWarrantyDays(30);
      setStatus('cotizacion');
    }
  }, [editingOrder, initialPrefillData, isOpen, existingCustomers]);

  // Real-time financial calculations
  const numPart = Math.max(0, parseFloat(partPrice) || 0);
  const numDown = Math.max(0, parseFloat(downPayment) || 0);
  const numDelivery = deliveryType === 'retiro_tienda' ? 0 : Math.max(0, parseFloat(deliveryFee) || 0);
  const numCore = Math.max(0, parseFloat(coreFee) || 0);
  
  // Total Bruto = Monto Parte + Monto Delivery + Monto Core
  const grossSubtotal = numPart + numDelivery + numCore;
  // Saldo Pendiente a Cobrar = Subtotal - Abono / Anticipo
  const balanceDue = Math.max(0, grossSubtotal - numDown);

  const handlePriceChange = (val: string) => {
    setPartPrice(val);
    const parsed = parseFloat(val) || 0;
    setWarrantyDays(calculateAutoWarranty(parsed));
    if (stepError) setStepError(null);
  };

  if (!isOpen) return null;

  // Validación de paso para avanzar (3 pasos)
  const validateAndNext = () => {
    setStepError(null);
    if (currentStep === 1) {
      if (!vehicleYear) {
        setStepError('Por favor selecciona el año del vehículo.');
        return;
      }
      if (!vehicleMake.trim()) {
        setStepError('Por favor selecciona la marca del vehículo.');
        return;
      }
      if (!vehicleModel.trim()) {
        setStepError('Por favor selecciona el modelo del vehículo.');
        return;
      }
      if (Number(vehicleMileage) <= 0) {
        setStepError('El millaje reportado debe ser mayor a 0.');
        return;
      }
      if (!mainPart.trim()) {
        setStepError('Por favor ingresa la pieza o refacción solicitada.');
        return;
      }
      if (!stockNumber.trim()) {
        setStepError('Por favor ingresa el stock de la yarda o proveedor.');
        return;
      }
      if (!vehicleMileage.trim()) {
        setStepError('Por favor ingresa el millaje reportado por el operador.');
        return;
      }
      setCurrentStep(2);
    } else if (currentStep === 2) {
      if (!customerName.trim()) {
        setStepError('Por favor ingresa el nombre completo o razón social del cliente.');
        return;
      }
      setCurrentStep(3);
    }
  };

  const handlePrev = () => {
    setStepError(null);
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
    }
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (currentStep < 3) {
      validateAndNext();
    }
  };

  const handleSubmit = () => {
    if (!vehicleYear) {
      setCurrentStep(1);
      setStepError('El año del vehículo es obligatorio.');
      return;
    }
    if (!vehicleMake.trim()) {
      setCurrentStep(1);
      setStepError('La marca del vehículo es obligatoria.');
      return;
    }
    if (!vehicleModel.trim()) {
      setCurrentStep(1);
      setStepError('El modelo del vehículo es obligatorio.');
      return;
    }
    if (Number(vehicleMileage) <= 0) {
      setCurrentStep(1);
      setStepError('El millaje reportado debe ser mayor a 0.');
      return;
    }
    if (!mainPart.trim()) {
      setCurrentStep(1);
      setStepError('La pieza solicitada es obligatoria.');
      return;
    }
    if (!stockNumber.trim()) {
      setCurrentStep(1);
      setStepError('El stock de la yarda o proveedor es obligatorio.');
      return;
    }
    if (!vehicleMileage.trim()) {
      setCurrentStep(1);
      setStepError('El millaje reportado por el operador es obligatorio.');
      return;
    }
    if (!customerName.trim()) {
      setCurrentStep(2);
      setStepError('El nombre del cliente es obligatorio.');
      return;
    }
    if (!partPrice.trim()) {
      setCurrentStep(3);
      setStepError('El monto de la parte es obligatorio.');
      return;
    }
    if (!downPayment.trim()) {
      setCurrentStep(3);
      setStepError('El abono / downpayment es obligatorio.');
      return;
    }
    if (deliveryType === 'envio_domicilio' && !deliveryFee.trim()) {
      setCurrentStep(3);
      setStepError('El flete / delivery es obligatorio.');
      return;
    }
    if (!coreFee.trim()) {
      setCurrentStep(3);
      setStepError('El depósito core fee es obligatorio.');
      return;
    }
    if (deliveryType === 'envio_domicilio' && !shippingAddress.trim()) {
      setCurrentStep(3);
      setStepError('La dirección de envío es obligatoria cuando la entrega es a domicilio.');
      return;
    }

    const randomIdNumber = Math.floor(100000 + Math.random() * 900000);
    const code = editingOrder?.code || `ORD-2026-${randomIdNumber.toString().slice(-4)}`;
    const initials = customerName
      .trim()
      .split(' ')
      .map((n) => n[0])
      .join('')
      .substring(0, 2)
      .toUpperCase() || 'CL';

    const savedOrder: Order = {
      ...(editingOrder || {}),
      id: editingOrder?.id || code,
      code: code,
      createdAt: editingOrder?.createdAt || 'Hoy, ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      advisor: advisor,
      status: status,
      mainPart: mainPart.trim(),
      productSpecs: productSpecs.trim(),
      stockNumber: stockNumber.trim(),
      workflowStep: editingOrder?.workflowStep || 1,
      warrantyDays: warrantyDays,
      saleNotified: status === 'pagado',
      customer: {
        id: selectedCustomerId || `CUST-${Math.floor(100 + Math.random() * 900)}`,
        name: customerName.trim(),
        company: selectedCustomerObj?.company || (customerType === 'Empresa' || customerType === 'Flota Mantenimiento' || customerType === 'Taller Mecánico' ? customerName.trim() : undefined),
        type: customerType,
        email: customerEmail.trim() || `${customerName.toLowerCase().replace(/[^a-z0-9]/g, '.')}@ejemplo.com`,
        phone: customerPhone.trim() || '+1 (919) 555-0188',
        location: shippingAddress.trim() ? `${shippingAddress.trim()}, ZIP ${zipCode}` : (selectedCustomerObj?.location || 'Raleigh, NC, USA'),
        shippingAddress: shippingAddress.trim(),
        address_shipping: shippingAddress.trim(),
        zip_code: zipCode.trim(),
        initials: initials,
      },
      vehicle: {
        vin: vehicleVIN.trim() || `1FTEW${Math.random().toString(36).substring(2, 8).toUpperCase()}123`,
        plate: editingOrder?.vehicle.plate || '',
        make: vehicleMake.trim(),
        model: vehicleModel.trim(),
        year: Number(vehicleYear),
        trim: '',
        transmission: vehicleTransmission.trim() || undefined,
        mileage: vehicleMileage.trim(),
        color: vehicleColor.trim() || 'Gris Grafito',
        colorHex: '#4b5563',
      },
      financials: {
        partPrice: numPart,
        baseMSRP: numPart,
        downPayment: numDown,
        advancePayment: numDown,
        deliveryFee: numDelivery,
        coreFee: numCore,
        subtotal: grossSubtotal,
        total: grossSubtotal,
        balanceDue: balanceDue,
      },
      deliveryType: deliveryType,
      notes: notes.trim(),
    };

    if (editingOrder && onUpdateOrder) {
      onUpdateOrder(savedOrder);
    } else {
      onCreateOrder(savedOrder);
    }
    onClose();
  };

  const stepsConfig = [
    { num: 1, label: 'Vehículo & Pieza', icon: 'directions_car', desc: 'Ficha y refacción solicitada' },
    { num: 2, label: 'Datos del Cliente', icon: 'person', desc: 'Contacto, taller y despacho' },
    { num: 3, label: 'Finanzas y Envío', icon: 'account_balance_wallet', desc: 'Liquidación, flete y garantía' },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/85 backdrop-blur-xl animate-fade-in">
      <div className="bg-[#070c18]/95 backdrop-blur-2xl border border-cyan-500/30 rounded-3xl w-full max-w-3xl max-h-[92vh] overflow-y-auto shadow-[0_20px_60px_rgba(0,0,0,0.85)] flex flex-col custom-scrollbar relative overflow-hidden">
        {/* Laser Hairline */}
        <div className="cyber-laser-bar absolute top-0 left-0 right-0 z-30" />

        {/* Header con Título y Botón Cerrar */}
        <div className="p-4 sm:p-5 border-b border-cyan-500/20 flex justify-between items-center bg-[#0a1022]/90 backdrop-blur-md sticky top-0 z-20">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-cyan-500/15 text-cyan-400 flex items-center justify-center border border-cyan-500/30 shadow-[0_0_12px_rgba(6,182,212,0.25)] shrink-0">
              <span className="material-symbols-outlined text-[20px]">add_shopping_cart</span>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-base sm:text-lg text-slate-100 tracking-tight">
                  {editingOrder ? 'Editar Orden de Trabajo' : 'Crear Nueva Orden de Trabajo'}
                </h3>
                <span className="text-[10px] bg-cyan-950/50 text-cyan-300 border border-cyan-500/30 px-2 py-0.5 rounded-full font-mono font-bold">
                  Paso {currentStep} de 3
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Asistente guiado: 1. Vehículo y Pieza → 2. Cliente → 3. Finanzas y Envío
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1.5 rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        {/* STEPPER NAVIGATION BAR */}
        <div className="bg-[#050914]/90 border-b border-cyan-500/20 px-4 py-3 sm:px-6">
          <div className="grid grid-cols-3 gap-2 relative">
            {stepsConfig.map((s) => {
              const isCompleted = s.num < currentStep;
              const isCurrent = s.num === currentStep;

              return (
                <button
                  type="button"
                  key={s.num}
                  onClick={() => {
                    if (s.num <= currentStep) {
                      setStepError(null);
                      setCurrentStep(s.num);
                    }
                  }}
                  className={`flex flex-col sm:flex-row items-center sm:items-start gap-2.5 p-2.5 rounded-xl transition-all text-left ${
                    isCurrent
                      ? 'bg-cyan-950/40 border border-cyan-500/60 shadow-[0_0_15px_rgba(6,182,212,0.15)]'
                      : isCompleted
                      ? 'bg-emerald-950/20 border border-emerald-500/30 hover:bg-emerald-950/30 cursor-pointer'
                      : 'bg-transparent border border-transparent opacity-40 cursor-not-allowed'
                  }`}
                >
                  <div
                    className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 text-xs font-bold font-mono transition-all ${
                      isCurrent
                        ? 'bg-gradient-to-r from-cyan-500 to-blue-600 text-slate-950 shadow-[0_0_10px_rgba(6,182,212,0.5)]'
                        : isCompleted
                        ? 'bg-emerald-500 text-slate-950'
                        : 'bg-slate-800 text-slate-400'
                    }`}
                  >
                    {isCompleted ? (
                      <span className="material-symbols-outlined text-[16px]">check</span>
                    ) : (
                      <span>{s.num}</span>
                    )}
                  </div>

                  <div className="hidden sm:block min-w-0">
                    <div className={`text-xs font-bold truncate ${isCurrent ? 'text-cyan-300' : isCompleted ? 'text-emerald-300' : 'text-slate-400'}`}>
                      {s.label}
                    </div>
                    <div className="text-[10px] text-slate-500 truncate">{s.desc}</div>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Progress Line */}
          <div className="w-full bg-slate-900 h-1.5 rounded-full mt-3 overflow-hidden">
            <div
              className="bg-gradient-to-r from-cyan-400 via-blue-500 to-emerald-400 h-full transition-all duration-300 rounded-full"
              style={{ width: `${(currentStep / 3) * 100}%` }}
            />
          </div>
        </div>

        {/* Error Alert if any */}
        {stepError && (
          <div className="mx-5 sm:mx-6 mt-4 p-3 bg-rose-950/30 border border-rose-500/30 rounded-xl flex items-center gap-2.5 text-xs text-rose-300 animate-shake">
            <span className="material-symbols-outlined text-[18px] text-rose-400">error</span>
            <span>{stepError}</span>
          </div>
        )}

        {/* Car-Part Auto-Import Alert Banner (Si existe prefill) */}
        {initialPrefillData && currentStep === 1 && (
          <div className="mx-5 sm:mx-6 mt-4 bg-emerald-950/30 border border-emerald-500/30 rounded-xl p-3 flex items-start gap-3 shadow-lg animate-fade-in">
            <span className="material-symbols-outlined text-emerald-400 text-[20px] shrink-0 mt-0.5">
              bolt
            </span>
            <div className="flex-1 text-xs">
              <strong className="text-emerald-300 font-bold block">
                Datos Pre-cargados desde Car-Part / Registro
              </strong>
              <p className="text-[11px] text-slate-300 mt-0.5">
                Vehículo ({vehicleMake} {vehicleModel} {vehicleYear}), pieza cotizada (${partPrice}), VIN y stock #{stockNumber || 'STK'}.
              </p>
            </div>
          </div>
        )}

        {/* Form Body */}
        <form onSubmit={handleFormSubmit} className="p-5 sm:p-6 flex flex-col gap-6 text-xs text-slate-300">
          {/* ========================================================================= */}
          {/* ========================================================================= */}
          {/* PASO 1: SOLICITUD DE DATOS DEL VEHÍCULO Y PIEZA */}
          {/* ========================================================================= */}
          {currentStep === 1 && (
            <div className="flex flex-col gap-5 animate-fade-in">
              <div className="flex items-center justify-between bg-[#080e1c] p-3.5 rounded-2xl border border-cyan-500/20">
                <div className="flex items-center gap-2.5 text-cyan-400">
                  <span className="material-symbols-outlined text-[20px]">directions_car</span>
                  <span className="font-bold text-xs uppercase tracking-wider font-mono">Paso 1: Datos del Vehículo & Pieza Solicitada</span>
                </div>
                <span className="text-[10px] text-cyan-400 font-mono font-bold bg-cyan-950/40 px-2 py-0.5 rounded-full border border-cyan-500/30">1 de 3</span>
              </div>

              {/* Ficha Técnica del Vehículo */}
              <div className="bg-[#050914] p-4.5 rounded-2xl border border-cyan-500/20 flex flex-col gap-3.5 shadow-sm">
                <div className="flex items-center gap-2 text-xs font-bold text-slate-100 border-b border-cyan-500/20 pb-2.5">
                  <span className="material-symbols-outlined text-[17px] text-cyan-400">garage</span>
                  <span>Ficha Técnica del Vehículo</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block mb-1 text-slate-400 font-medium text-[11px]">Año *</label>
                    <select
                      value={vehicleYear}
                      onChange={(e) => handleManualYearChange(e.target.value)}
                      className="w-full bg-[#070e1c] border border-cyan-500/30 rounded-xl p-2.5 text-slate-100 font-mono focus:outline-none focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400 cursor-pointer text-xs"
                    >
                      <option value="">Selecciona año</option>
                      {yearOptions.map((year) => (
                        <option key={year} value={year}>{year}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block mb-1 text-slate-400 font-medium text-[11px]">Marca *</label>
                    <select
                      value={vehicleMake}
                      onChange={(e) => handleManualMakeChange(e.target.value)}
                      disabled={!vehicleYear}
                      className="w-full bg-[#070e1c] border border-cyan-500/30 rounded-xl p-2.5 text-slate-100 focus:outline-none focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400 disabled:opacity-40 cursor-pointer text-xs"
                    >
                      <option value="">Selecciona marca</option>
                      {vehicleMake && !makeOptions.includes(vehicleMake) && (
                        <option value={vehicleMake}>{vehicleMake}</option>
                      )}
                      {makeOptions.map((make) => (
                        <option key={make} value={make}>{make}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block mb-1 text-slate-400 font-medium text-[11px]">Modelo *</label>
                    <select
                      required
                      autoFocus
                      value={vehicleModel}
                      onChange={(e) => {
                        setVehicleModel(e.target.value);
                        if (stepError) setStepError(null);
                      }}
                      disabled={!vehicleMake}
                      className="w-full bg-[#070e1c] border border-cyan-500/30 rounded-xl p-2.5 text-slate-100 focus:outline-none focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400 disabled:opacity-40 cursor-pointer text-xs"
                    >
                      <option value="">Selecciona modelo</option>
                      {vehicleModel && !modelOptions.includes(vehicleModel) && (
                        <option value={vehicleModel}>{vehicleModel}</option>
                      )}
                      {modelOptions.map((model) => (
                        <option key={model} value={model}>{model}</option>
                      ))}
                    </select>
                  </div>

                  <div className="sm:col-span-2">
                    <label className="block mb-1 text-slate-400 font-medium text-[11px]">Número de Serie (VIN - 17 Dígitos)</label>
                    <input
                      type="text"
                      value={vehicleVIN}
                      maxLength={17}
                      onChange={(e) => {
                        const nextVin = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
                        setVehicleVIN(nextVin);
                        if (nextVin.length === 17) void decodeVin(nextVin);
                        else {
                          setVinDecodeStatus('idle');
                          setVinDecodeMessage('');
                        }
                      }}
                      onBlur={() => void decodeVin(vehicleVIN)}
                      placeholder="1FTEW1EP5KFB81920"
                      className="w-full bg-[#070e1c] border border-cyan-500/30 rounded-xl p-2.5 text-slate-100 font-mono uppercase tracking-wider focus:outline-none focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400 text-xs shadow-inner"
                    />
                    <span className={`mt-1 block text-[10px] font-medium ${
                      vinDecodeStatus === 'error' ? 'text-rose-400' : vinDecodeStatus === 'success' ? 'text-emerald-400' : 'text-slate-500'
                    }`}>
                      {vinDecodeMessage || 'Se decodifica automáticamente al completar 17 caracteres'}
                    </span>
                  </div>

                  <div>
                    <label className="block mb-1 text-slate-400 font-medium text-[11px]">Millaje Reportado *</label>
                    <input
                      type="number"
                      min={0}
                      required
                      value={vehicleMileage}
                      onChange={(e) => {
                        setVehicleMileage(e.target.value);
                        if (stepError) setStepError(null);
                      }}
                      placeholder="0"
                      className="w-full bg-[#070e1c] border border-cyan-500/30 rounded-xl p-2.5 text-slate-100 font-mono focus:outline-none focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400 text-xs shadow-inner"
                    />
                  </div>
                </div>
              </div>

              {/* Pieza & Refacción Solicitada */}
              <div className="bg-[#050914] p-4.5 rounded-2xl border border-cyan-500/20 flex flex-col gap-3.5 shadow-sm">
                <div className="flex items-center gap-2 text-xs font-bold text-slate-100 border-b border-cyan-500/20 pb-2.5">
                  <span className="material-symbols-outlined text-[17px] text-amber-400">settings</span>
                  <span>Pieza Solicitada & Datos de Yarda / Stock</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="sm:col-span-2">
                    <label className="block mb-1 text-slate-400 font-medium text-[11px]">Pieza Principal Solicitada *</label>
                    <select
                      required
                      value={mainPart}
                      onChange={(e) => {
                        setMainPart(e.target.value);
                        if (stepError) setStepError(null);
                      }}
                      className="w-full bg-[#070e1c] border border-cyan-500/30 rounded-xl p-2.5 text-slate-100 font-medium focus:outline-none focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400 text-xs cursor-pointer"
                    >
                      <option value="">Seleccionar tipo</option>
                      <option value="Engine">Engine (Motor)</option>
                      <option value="Transmission">Transmission (Transmisión)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block mb-1 text-slate-400 font-medium text-[11px]">Stock # (Yarda / Proveedor) *</label>
                    <input
                      type="text"
                      required
                      value={stockNumber}
                      onChange={(e) => {
                        setStockNumber(e.target.value);
                        if (stepError) setStepError(null);
                      }}
                      placeholder="STK-RDZ-4491"
                      className="w-full bg-[#070e1c] border border-cyan-500/30 rounded-xl p-2.5 text-slate-100 font-mono focus:outline-none focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400 text-xs shadow-inner"
                    />
                  </div>

                  <div className="sm:col-span-3">
                    <label className="block mb-1 text-slate-400 font-medium text-[11px]">Especificaciones Técnicas / Interchange Notes</label>
                    <input
                      type="text"
                      value={productSpecs}
                      onChange={(e) => setProductSpecs(e.target.value)}
                      placeholder="Ej. 2.7L Turbo VIN P, RUNS GREAT TESTED, COMPRESSION 175 PSI, OEM spec"
                      className="w-full bg-[#070e1c] border border-cyan-500/30 rounded-xl p-2.5 text-slate-100 text-xs focus:outline-none focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400 shadow-inner"
                    />
                  </div>

                  <div className="sm:col-span-3">
                    <label className="block mb-1 text-slate-400 font-medium text-[11px]">Notas de Búsqueda / Yarda / Instrucciones Internas</label>
                    <textarea
                      rows={2}
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder="Observaciones de compra, contacto del desguace, instrucciones de embalaje..."
                      className="w-full bg-[#070e1c] border border-cyan-500/30 rounded-xl p-2.5 text-slate-100 text-xs focus:outline-none focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400 shadow-inner"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ========================================================================= */}
          {/* ========================================================================= */}
          {/* PASO 2: LLENAR DATOS DEL CLIENTE / SELECCIONAR CLIENTE EXISTENTE */}
          {/* ========================================================================= */}
          {currentStep === 2 && (
            <div className="flex flex-col gap-4 animate-fade-in">
              {/* Header del Paso 2 */}
              <div className="flex items-center justify-between bg-[#080e1c] p-3.5 rounded-2xl border border-cyan-500/20">
                <div className="flex items-center gap-2.5 text-emerald-400">
                  <span className="material-symbols-outlined text-[20px]">person</span>
                  <span className="font-bold text-xs uppercase tracking-wider font-mono">Paso 2: Datos del Cliente & Despacho</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-emerald-400 font-mono font-bold bg-emerald-950/40 px-2 py-0.5 rounded-full border border-emerald-500/30">2 de 3</span>
                </div>
              </div>

              {/* Selector de Modo: Buscar Existente vs Nuevo Manual */}
              <div className="flex items-center bg-[#050914] p-1.5 rounded-2xl border border-cyan-500/20 gap-1.5 shadow-inner">
                <button
                  type="button"
                  onClick={() => {
                    setClientMode('search');
                    if (stepError) setStepError(null);
                  }}
                  className={`flex-1 py-2 px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all cursor-pointer ${
                    clientMode === 'search'
                      ? 'bg-gradient-to-r from-cyan-500 to-blue-600 text-slate-950 shadow-[0_0_12px_rgba(6,182,212,0.35)]'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
                  }`}
                >
                  <span className="material-symbols-outlined text-[16px]">contacts</span>
                  <span>Seleccionar Cliente Existente (CRM)</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-mono font-bold ${
                    clientMode === 'search' ? 'bg-black/30 text-slate-950' : 'bg-slate-800 text-slate-400'
                  }`}>
                    {existingCustomers.length}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setClientMode('manual');
                    setSelectedCustomerId(null);
                    if (stepError) setStepError(null);
                  }}
                  className={`flex-1 py-2 px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all cursor-pointer ${
                    clientMode === 'manual'
                      ? 'bg-gradient-to-r from-cyan-500 to-blue-600 text-slate-950 shadow-[0_0_12px_rgba(6,182,212,0.35)]'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
                  }`}
                >
                  <span className="material-symbols-outlined text-[16px]">person_add</span>
                  <span>Registrar Nuevo Cliente Manual</span>
                </button>
              </div>

              {/* MODO 1: SELECCIONAR CLIENTE EXISTENTE */}
              {clientMode === 'search' && (
                <div className="flex flex-col gap-3">
                  {/* SI YA HAY UN CLIENTE SELECCIONADO: Tarjeta de Cliente Vinculado */}
                  {selectedCustomerId && selectedCustomerObj ? (
                    <div className="bg-[#050914] border-2 border-cyan-500/50 rounded-2xl p-4.5 flex flex-col gap-3.5 shadow-lg relative overflow-hidden">
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-3">
                          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-cyan-500 to-emerald-500 text-slate-950 font-black text-base flex items-center justify-center shadow-[0_0_15px_rgba(6,182,212,0.4)]">
                            {selectedCustomerObj.initials || selectedCustomerObj.name.substring(0, 2).toUpperCase()}
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <h4 className="font-bold text-sm text-slate-100">
                                {selectedCustomerObj.name}
                              </h4>
                              <span className="text-[10px] bg-emerald-950/50 text-emerald-300 border border-emerald-500/40 px-2 py-0.5 rounded-full font-mono font-bold flex items-center gap-1">
                                <span className="material-symbols-outlined text-[12px] text-emerald-400">verified</span>
                                Cliente CRM Vinculado
                              </span>
                            </div>
                            {selectedCustomerObj.company && (
                              <p className="text-xs text-slate-400 font-medium flex items-center gap-1 mt-0.5">
                                <span className="material-symbols-outlined text-[13px] text-amber-400">domain</span>
                                {selectedCustomerObj.company}
                              </p>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setSelectedCustomerId(null)}
                            className="px-2.5 py-1.5 text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl border border-slate-700 flex items-center gap-1 cursor-pointer transition-colors font-semibold"
                          >
                            <span className="material-symbols-outlined text-[14px]">swap_horiz</span>
                            <span>Cambiar</span>
                          </button>
                          <button
                            type="button"
                            onClick={handleClearCustomerSelection}
                            className="p-1.5 text-xs bg-rose-950/30 hover:bg-rose-950/60 text-rose-400 rounded-xl border border-rose-500/30 cursor-pointer transition-colors"
                            title="Desvincular cliente"
                          >
                            <span className="material-symbols-outlined text-[16px]">close</span>
                          </button>
                        </div>
                      </div>

                      {/* Detalles de Contacto Resumidos */}
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 bg-[#070e1c] p-3 rounded-xl border border-cyan-500/20 text-xs">
                        <div className="flex items-center gap-2">
                          <span className="material-symbols-outlined text-[15px] text-emerald-400">call</span>
                          <span className="font-mono text-slate-200 font-medium">{customerPhone || 'Sin teléfono'}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="material-symbols-outlined text-[15px] text-cyan-400">mail</span>
                          <span className="text-slate-300 truncate">{customerEmail || 'Sin email'}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="material-symbols-outlined text-[15px] text-amber-400">badge</span>
                          <span className="text-slate-200 font-medium">{customerType}</span>
                        </div>
                      </div>

                      {/* Dirección de despacho editable */}
                      <div className="bg-[#070e1c] p-3.5 rounded-xl border border-cyan-500/20 flex flex-col gap-2">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1.5 text-xs font-bold text-slate-100">
                            <span className="material-symbols-outlined text-[15px] text-rose-400">local_shipping</span>
                            <span>Dirección de Despacho para esta Orden</span>
                          </div>
                          <span className="text-[10px] text-slate-400">(Editable para este pedido)</span>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                          <div className="sm:col-span-2">
                            <input
                              type="text"
                              value={shippingAddress}
                              onChange={(e) => setShippingAddress(e.target.value)}
                              placeholder="Dirección completa de entrega o taller"
                              className="w-full bg-[#050914] border border-cyan-500/30 rounded-xl p-2.5 text-slate-100 text-xs focus:outline-none focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400"
                            />
                          </div>
                          <div>
                            <input
                              type="text"
                              value={zipCode}
                              onChange={(e) => setZipCode(e.target.value)}
                              placeholder="ZIP (Ej. 27520)"
                              className="w-full bg-[#050914] border border-cyan-500/30 rounded-xl p-2.5 text-slate-100 font-mono text-xs focus:outline-none focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400"
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    /* SI NO HAY CLIENTE SELECCIONADO: Buscador & Lista de Clientes */
                    <div className="bg-[#050914] p-4.5 rounded-2xl border border-cyan-500/20 flex flex-col gap-3.5 shadow-sm">
                      {/* Barra de Búsqueda */}
                      <div className="relative">
                        <span className="material-symbols-outlined absolute left-3.5 top-3 text-cyan-400 text-[18px]">
                          search
                        </span>
                        <input
                          type="text"
                          autoFocus
                          value={clientSearchQuery}
                          onChange={(e) => {
                            setClientSearchQuery(e.target.value);
                            if (stepError) setStepError(null);
                          }}
                          placeholder="Buscar cliente por nombre, empresa, teléfono, email, ciudad o ZIP..."
                          className="w-full bg-[#070e1c] border border-cyan-500/30 rounded-xl py-2.5 pl-10 pr-8 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400 shadow-inner"
                        />
                        {clientSearchQuery && (
                          <button
                            type="button"
                            onClick={() => setClientSearchQuery('')}
                            className="absolute right-2.5 top-2.5 text-slate-400 hover:text-white cursor-pointer"
                          >
                            <span className="material-symbols-outlined text-[16px]">cancel</span>
                          </button>
                        )}
                      </div>

                      {/* Filtros de Categoría */}
                      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 custom-scrollbar">
                        {[
                          { id: 'all', label: 'Todos' },
                          { id: 'Taller Mecánico', label: 'Talleres Mecánicos' },
                          { id: 'VIP', label: 'VIP' },
                          { id: 'Flota Mantenimiento', label: 'Flotas' },
                          { id: 'Empresa', label: 'Empresas' },
                          { id: 'Particular', label: 'Particulares' },
                        ].map((cat) => (
                          <button
                            key={cat.id}
                            type="button"
                            onClick={() => setSelectedCategoryFilter(cat.id)}
                            className={`px-3 py-1 rounded-xl text-[11px] font-semibold whitespace-nowrap transition-all cursor-pointer ${
                              selectedCategoryFilter === cat.id
                                ? 'bg-cyan-950/60 border border-cyan-500/60 text-cyan-300 shadow-[0_0_10px_rgba(6,182,212,0.2)]'
                                : 'bg-[#070e1c] text-slate-400 hover:text-slate-200 border border-slate-800'
                            }`}
                          >
                            {cat.label}
                          </button>
                        ))}
                      </div>

                      {/* Clientes Frecuentes / Atajos Rápidos */}
                      {!clientSearchQuery && (
                        <div className="flex flex-col gap-1.5 pt-1">
                          <span className="text-[10px] text-cyan-400 uppercase tracking-wider font-mono font-bold">
                            Clientes Frecuentes Sugeridos:
                          </span>
                          <div className="flex flex-wrap gap-1.5">
                            {existingCustomers.slice(0, 5).map((quickCust) => (
                              <button
                                key={quickCust.id}
                                type="button"
                                onClick={() => handleSelectCustomer(quickCust)}
                                className="px-3 py-1.5 rounded-xl bg-[#070e1c] hover:bg-cyan-950/40 hover:border-cyan-500/50 border border-slate-800 text-slate-200 text-[11px] flex items-center gap-2 transition-all cursor-pointer"
                              >
                                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                                <span className="font-semibold">{quickCust.name}</span>
                                <span className="text-[9px] text-slate-400 font-mono">({quickCust.type})</span>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Lista Interactiva de Resultados */}
                      <div className="max-h-56 overflow-y-auto flex flex-col gap-1.5 pr-1 custom-scrollbar mt-1">
                        {filteredCustomers.length > 0 ? (
                          filteredCustomers.map((cust) => {
                            const isSelected = selectedCustomerId === cust.id;
                            return (
                              <div
                                key={cust.id}
                                onClick={() => handleSelectCustomer(cust)}
                                className={`p-3 rounded-2xl border flex items-center justify-between gap-3 cursor-pointer transition-all ${
                                  isSelected
                                    ? 'bg-cyan-950/40 border-cyan-500 text-white shadow-[0_0_15px_rgba(6,182,212,0.2)]'
                                    : 'bg-[#070e1c]/80 hover:bg-[#070e1c] border-slate-800 hover:border-cyan-500/30 text-slate-300'
                                }`}
                              >
                                <div className="flex items-center gap-2.5 min-w-0">
                                  <div className="w-8 h-8 rounded-xl bg-[#0a1428] border border-cyan-500/30 text-cyan-400 font-bold text-xs flex items-center justify-center shrink-0 shadow-inner">
                                    {cust.initials || cust.name.substring(0, 2).toUpperCase()}
                                  </div>
                                  <div className="min-w-0">
                                    <div className="flex items-center gap-2">
                                      <span className="font-bold text-xs text-slate-100 truncate">
                                        {cust.name}
                                      </span>
                                      <span className={`text-[9px] px-2 py-0.5 rounded-full font-bold shrink-0 font-mono ${
                                        cust.type === 'VIP'
                                          ? 'bg-purple-950/40 text-purple-300 border border-purple-500/30'
                                          : cust.type === 'Taller Mecánico'
                                          ? 'bg-emerald-950/40 text-emerald-300 border border-emerald-500/30'
                                          : cust.type === 'Flota Mantenimiento'
                                          ? 'bg-amber-950/40 text-amber-300 border border-amber-500/30'
                                          : 'bg-slate-800 text-slate-300'
                                      }`}>
                                        {cust.type}
                                      </span>
                                    </div>
                                    <div className="text-[11px] text-slate-400 flex items-center gap-2 truncate mt-0.5">
                                      {cust.company && <span className="text-slate-200">{cust.company} •</span>}
                                      <span className="font-mono text-slate-300">{cust.phone}</span>
                                      {cust.location && <span>• {cust.location}</span>}
                                    </div>
                                  </div>
                                </div>

                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleSelectCustomer(cust);
                                  }}
                                  className="px-3.5 py-1.5 bg-cyan-500/15 hover:bg-cyan-500 text-cyan-400 hover:text-slate-950 rounded-xl text-xs font-bold border border-cyan-500/40 transition-all shrink-0 cursor-pointer flex items-center gap-1.5"
                                >
                                  <span className="material-symbols-outlined text-[15px]">check</span>
                                  <span>Seleccionar</span>
                                </button>
                              </div>
                            );
                          })
                        ) : (
                          <div className="p-6 text-center text-slate-400 flex flex-col items-center gap-2 bg-[#070e1c]/40 rounded-2xl border border-dashed border-slate-800">
                            <span className="material-symbols-outlined text-[28px] text-slate-600">person_search</span>
                            <p className="text-xs">
                              No se encontraron clientes con el criterio &quot;{clientSearchQuery}&quot;.
                            </p>
                            <button
                              type="button"
                              onClick={() => {
                                setCustomerName(clientSearchQuery);
                                setClientMode('manual');
                              }}
                              className="mt-1 px-4 py-2 bg-gradient-to-r from-cyan-500 to-blue-600 text-slate-950 rounded-xl text-xs font-black flex items-center gap-1.5 cursor-pointer shadow-[0_0_12px_rgba(6,182,212,0.35)] active:scale-95"
                            >
                              <span className="material-symbols-outlined text-[15px]">person_add</span>
                              <span>Registrar &quot;{clientSearchQuery}&quot; como nuevo</span>
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* MODO 2: REGISTRAR NUEVO CLIENTE MANUAL */}
              {clientMode === 'manual' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 bg-[#050914] p-4.5 rounded-2xl border border-cyan-500/20 shadow-sm">
                  <div>
                    <label className="block mb-1 text-slate-400 font-medium text-[11px]">Nombre Completo / Razón Social *</label>
                    <input
                      type="text"
                      required
                      autoFocus
                      value={customerName}
                      onChange={(e) => {
                        setCustomerName(e.target.value);
                        if (stepError) setStepError(null);
                      }}
                      placeholder="Ej. Roberto Sánchez o Taller Hermanos Gómez"
                      className="w-full bg-[#070e1c] border border-cyan-500/30 rounded-xl p-2.5 text-slate-100 text-xs focus:outline-none focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400 shadow-inner"
                    />
                  </div>

                  <div>
                    <label className="block mb-1 text-slate-400 font-medium text-[11px]">Tipo de Cliente</label>
                    <select
                      value={customerType}
                      onChange={(e) => setCustomerType(e.target.value as any)}
                      className="w-full bg-[#070e1c] border border-cyan-500/30 rounded-xl p-2.5 text-slate-100 text-xs focus:outline-none focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400 cursor-pointer"
                    >
                      <option value="Particular">Particular (Cliente Directo)</option>
                      <option value="Taller Mecánico">Taller Mecánico Aliado</option>
                      <option value="Empresa">Empresa / Corporativo</option>
                      <option value="Flota Mantenimiento">Flota Mantenimiento</option>
                      <option value="VIP">Cliente VIP (Trato Preferencial)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block mb-1 text-slate-400 font-medium text-[11px]">Teléfono / WhatsApp de Contacto *</label>
                    <input
                      type="text"
                      value={customerPhone}
                      onChange={(e) => setCustomerPhone(e.target.value)}
                      placeholder="+1 (919) 555-0188"
                      className="w-full bg-[#070e1c] border border-cyan-500/30 rounded-xl p-2.5 text-slate-100 font-mono text-xs focus:outline-none focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400 shadow-inner"
                    />
                  </div>

                  <div>
                    <label className="block mb-1 text-slate-400 font-medium text-[11px]">Correo Electrónico (Notificaciones)</label>
                    <input
                      type="email"
                      value={customerEmail}
                      onChange={(e) => setCustomerEmail(e.target.value)}
                      placeholder="cliente@ejemplo.com"
                      className="w-full bg-[#070e1c] border border-cyan-500/30 rounded-xl p-2.5 text-slate-100 text-xs focus:outline-none focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400 shadow-inner"
                    />
                  </div>

                  <div className="sm:col-span-2 grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
                    <div className="sm:col-span-2">
                      <label className="block mb-1 text-slate-400 font-medium text-[11px]">Dirección de Despacho / Taller</label>
                      <input
                        type="text"
                        value={shippingAddress}
                        onChange={(e) => setShippingAddress(e.target.value)}
                        placeholder="Calle, Número, Taller / Local, Ciudad"
                        className="w-full bg-[#070e1c] border border-cyan-500/30 rounded-xl p-2.5 text-slate-100 text-xs focus:outline-none focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400 shadow-inner"
                      />
                    </div>
                    <div>
                      <label className="block mb-1 text-slate-400 font-medium text-[11px]">Código Postal (ZIP)</label>
                      <input
                        type="text"
                        value={zipCode}
                        onChange={(e) => setZipCode(e.target.value)}
                        placeholder="Ej. 27520"
                        className="w-full bg-[#070e1c] border border-cyan-500/30 rounded-xl p-2.5 text-slate-100 font-mono text-xs focus:outline-none focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400 shadow-inner"
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ========================================================================= */}
          {/* ========================================================================= */}
          {/* PASO 3: FINANZAS Y ENVÍO */}
          {/* ========================================================================= */}
          {currentStep === 3 && (
            <div className="flex flex-col gap-4 animate-fade-in">
              <div className="flex items-center justify-between bg-[#080e1c] p-3.5 rounded-2xl border border-cyan-500/20">
                <div className="flex items-center gap-2.5 text-purple-400">
                  <span className="material-symbols-outlined text-[20px]">account_balance_wallet</span>
                  <span className="font-bold text-xs uppercase tracking-wider font-mono">Paso 3: Finanzas, Envío & Liquidación</span>
                </div>
                <span className="text-[10px] text-purple-400 font-mono font-bold bg-purple-950/40 px-2 py-0.5 rounded-full border border-purple-500/30">3 de 3</span>
              </div>

              {/* Inputs de Desglose */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5 bg-[#050914] p-4.5 rounded-2xl border border-cyan-500/20 shadow-sm">
                <div>
                  <label className="block mb-1 text-cyan-400 font-bold text-[11px] font-mono">1. Monto Parte ($ USD) *</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-cyan-400 font-bold text-xs font-mono">$</span>
                    <input
                      type="number"
                      min={0}
                      step="any"
                      autoFocus
                      value={partPrice}
                      onChange={(e) => handlePriceChange(e.target.value)}
                      placeholder="0.00"
                      className="w-full bg-[#070e1c] border border-cyan-500/40 rounded-xl py-2.5 pl-7 pr-2 font-mono text-cyan-300 font-bold text-xs focus:outline-none focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400 shadow-inner"
                    />
                  </div>
                </div>

                <div>
                  <label className="block mb-1 text-amber-400 font-bold text-[11px] font-mono">2. Abono / Anticipo ($)</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-amber-400 font-bold text-xs font-mono">$</span>
                    <input
                      type="number"
                      min={0}
                      step="any"
                      value={downPayment}
                      onChange={(e) => {
                        setDownPayment(e.target.value);
                        if (stepError) setStepError(null);
                      }}
                      placeholder="0.00"
                      className="w-full bg-[#070e1c] border border-amber-500/40 rounded-xl py-2.5 pl-7 pr-2 font-mono text-amber-300 font-bold text-xs focus:outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-400 shadow-inner"
                    />
                  </div>
                </div>

                <div>
                  <label className="block mb-1 text-slate-400 font-medium text-[11px] font-mono">3. Flete / Delivery ($)</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-bold text-xs font-mono">$</span>
                    <input
                      type="number"
                      min={0}
                      step="any"
                      value={deliveryFee}
                      onChange={(e) => {
                        setDeliveryFee(e.target.value);
                        if (stepError) setStepError(null);
                      }}
                      placeholder="0.00"
                      className="w-full bg-[#070e1c] border border-cyan-500/30 rounded-xl py-2.5 pl-7 pr-2 font-mono text-slate-100 font-bold text-xs focus:outline-none focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400 disabled:opacity-40 shadow-inner"
                    />
                  </div>
                </div>

                <div>
                  <label className="block mb-1 text-slate-400 font-medium text-[11px] font-mono">4. Depósito Core Fee ($)</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-bold text-xs font-mono">$</span>
                    <input
                      type="number"
                      min={0}
                      step="any"
                      value={coreFee}
                      onChange={(e) => {
                        setCoreFee(e.target.value);
                        if (stepError) setStepError(null);
                      }}
                      placeholder="0.00"
                      className="w-full bg-[#070e1c] border border-cyan-500/30 rounded-xl py-2.5 pl-7 pr-2 font-mono text-slate-100 font-bold text-xs focus:outline-none focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400 shadow-inner"
                    />
                  </div>
                </div>
              </div>

              {/* Total Balance Calculation Bar */}
              <div className="bg-[#060c1a] p-4.5 rounded-2xl border border-cyan-500/40 flex flex-col sm:flex-row items-center justify-between gap-3 shadow-[0_0_20px_rgba(6,182,212,0.15)] relative overflow-hidden">
                <div className="flex items-center gap-4 text-xs">
                  <div>
                    <span className="text-slate-400 block text-[10px] uppercase font-mono">Subtotal Bruto:</span>
                    <span className="font-mono font-bold text-slate-100 text-sm">${grossSubtotal.toFixed(2)}</span>
                  </div>
                  <span className="text-slate-600 text-lg font-light">-</span>
                  <div>
                    <span className="text-amber-400 block text-[10px] uppercase font-mono">Anticipo Pagado:</span>
                    <span className="font-mono font-bold text-amber-400 text-sm">${numDown.toFixed(2)}</span>
                  </div>
                  <span className="text-slate-600 text-lg font-light">=</span>
                </div>

                <div className="text-right">
                  <span className="text-[10px] text-emerald-400 uppercase font-bold tracking-wider block font-mono">
                    Saldo Restante al Despachar (Balance Due):
                  </span>
                  <span className="text-xl sm:text-2xl font-black font-mono text-cyan-300 drop-shadow-[0_0_12px_rgba(6,182,212,0.6)]">
                    ${balanceDue.toFixed(2)} <span className="text-xs font-normal text-slate-400">USD</span>
                  </span>
                </div>
              </div>

              {/* Políticas de Entrega y Garantía */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-[#050914] p-4.5 rounded-2xl border border-cyan-500/20 shadow-sm">
                <div>
                  <label className="block mb-1.5 text-slate-300 font-semibold text-xs">Tipo de Entrega / Despacho</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setDeliveryType('retiro_tienda');
                      }}
                      className={`py-2.5 px-3 rounded-xl border text-xs font-bold flex items-center justify-center gap-2 transition-all cursor-pointer ${
                        deliveryType === 'retiro_tienda'
                          ? 'bg-emerald-950/40 border-emerald-500 text-emerald-300 shadow-[0_0_12px_rgba(16,185,129,0.25)]'
                          : 'bg-[#070e1c] border-slate-800 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <span className="material-symbols-outlined text-[17px]">storefront</span>
                      <span>Retiro en Patio ($0)</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setDeliveryType('envio_domicilio');
                      }}
                      className={`py-2.5 px-3 rounded-xl border text-xs font-bold flex items-center justify-center gap-2 transition-all cursor-pointer ${
                        deliveryType === 'envio_domicilio'
                          ? 'bg-cyan-950/40 border-cyan-500 text-cyan-300 shadow-[0_0_12px_rgba(6,182,212,0.25)]'
                          : 'bg-[#070e1c] border-slate-800 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <span className="material-symbols-outlined text-[17px]">local_shipping</span>
                      <span>Envío a Domicilio</span>
                    </button>
                  </div>
                </div>

                {deliveryType === 'envio_domicilio' && (
                  <div className="sm:col-span-2 order-last">
                    <label className="block mb-1 text-cyan-400 font-semibold text-xs">Dirección de Envío a Domicilio *</label>
                    <div className="grid grid-cols-1 sm:grid-cols-[1fr_130px] gap-2">
                      <input
                        type="text"
                        value={shippingAddress}
                        onChange={(e) => {
                          setShippingAddress(e.target.value);
                          if (stepError) setStepError(null);
                        }}
                        placeholder="Calle, número, ciudad, estado"
                        className="w-full bg-[#070e1c] border border-cyan-500/40 rounded-xl p-2.5 text-slate-100 text-xs focus:outline-none focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400 shadow-inner"
                      />
                      <input
                        type="text"
                        value={zipCode}
                        onChange={(e) => setZipCode(e.target.value)}
                        placeholder="ZIP"
                        className="w-full bg-[#070e1c] border border-cyan-500/30 rounded-xl p-2.5 text-slate-100 font-mono text-xs focus:outline-none focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400 shadow-inner"
                      />
                    </div>
                    <p className="mt-1 text-[10px] text-slate-400">Esta dirección se almacena junto con la orden y se usa para despacho.</p>
                  </div>
                )}

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-slate-300 font-semibold text-xs">
                      Garantía (Auto-asignada según precio)
                    </label>
                    <span className="text-[10px] text-emerald-400 font-mono font-bold">
                      {warrantyDays} Días Activa
                    </span>
                  </div>
                  <div className="rounded-xl border border-cyan-500/20 bg-[#070e1c] px-3.5 py-2 text-xs text-slate-300 flex items-center justify-between">
                    <span className="font-mono font-bold text-emerald-400">{warrantyDays} días</span>
                    <span className="text-slate-500 text-[11px]">calculados por monto de parte</span>
                  </div>
                </div>
              </div>

              {/* Asesor y Estatus Inicial */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-[#050914] p-4.5 rounded-2xl border border-cyan-500/20 shadow-sm">
                <div>
                  <label className="block mb-1 text-slate-400 text-xs font-semibold">Asesor Comercial Asignado</label>
                  <select
                    value={advisor}
                    onChange={(e) => setAdvisor(e.target.value)}
                    className="w-full bg-[#070e1c] border border-cyan-500/30 rounded-xl p-2.5 text-slate-100 text-xs focus:outline-none focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400 cursor-pointer"
                  >
                    <option value="Carlos Mendoza (Ventas)">Carlos Mendoza (Ventas)</option>
                    <option value="Alejandro Morales (Ventas)">Alejandro Morales (Ventas)</option>
                    <option value="Laura Méndez (Call Center)">Laura Méndez (Call Center)</option>
                    <option value="Douglas Villalobos (Admin)">Douglas Villalobos (Admin)</option>
                  </select>
                </div>

                <div>
                  <label className="block mb-1 text-slate-400 text-xs font-semibold">Estatus Inicial de Apertura</label>
                  <div className="rounded-xl border border-cyan-500/40 bg-cyan-950/40 px-3.5 py-2.5 text-xs font-bold text-cyan-300 font-mono flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
                    <span>Cotización</span>
                  </div>
                </div>
              </div>

              {/* Resumen Final de la Orden */}
              <div className="bg-[#070e1c] border border-cyan-500/30 rounded-2xl p-4 flex items-center justify-between text-xs shadow-inner">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-cyan-500/15 text-cyan-400 flex items-center justify-center border border-cyan-500/30 shrink-0">
                    <span className="material-symbols-outlined text-[19px]">verified</span>
                  </div>
                  <div>
                    <div className="text-slate-100 font-bold">{customerName || 'Cliente'} — {vehicleMake} {vehicleModel} {vehicleYear}</div>
                    <div className="text-[11px] text-slate-400">{mainPart} • Garantía {warrantyDays} días • {deliveryType === 'retiro_tienda' ? 'Retiro en Patio' : 'Envío a Domicilio'}</div>
                  </div>
                </div>
                <div className="text-right">
                  <span className="text-[10px] text-slate-400 uppercase font-mono block">Total a Pagar</span>
                  <span className="text-base font-bold font-mono text-emerald-400">${grossSubtotal.toFixed(2)}</span>
                </div>
              </div>
            </div>
          )}

          {/* STEPPER FOOTER CONTROLS */}
          <div className="pt-3.5 border-t border-cyan-500/20 flex items-center justify-between gap-3 bg-[#0a1022]/90 backdrop-blur-md -mx-5 -mb-5 sm:-mx-6 sm:-mb-6 p-4.5 rounded-b-3xl sticky bottom-0 z-20">
            <div>
              {currentStep > 1 ? (
                <button
                  type="button"
                  onClick={handlePrev}
                  className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs flex items-center gap-1.5 transition-all cursor-pointer active:scale-95 border border-slate-700"
                >
                  <span className="material-symbols-outlined text-[16px]">arrow_back</span>
                  <span>Anterior</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors cursor-pointer text-xs font-semibold"
                >
                  Cancelar
                </button>
              )}
            </div>

            <div className="flex items-center gap-2.5">
              <span className="text-[11px] text-slate-500 hidden sm:inline font-mono">
                Paso {currentStep} de 3
              </span>

              {currentStep < 3 ? (
                <button
                  type="button"
                  onClick={validateAndNext}
                  className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 font-black transition-all shadow-[0_0_15px_rgba(6,182,212,0.35)] cursor-pointer active:scale-95 flex items-center gap-1.5 text-xs"
                >
                  <span>Siguiente Paso</span>
                  <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleSubmit}
                  className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-slate-950 font-black transition-all shadow-[0_0_20px_rgba(16,185,129,0.4)] cursor-pointer active:scale-95 flex items-center gap-2 text-xs"
                >
                  <span className="material-symbols-outlined text-[18px]">check_circle</span>
                  <span>{editingOrder ? 'Guardar Cambios' : 'Guardar y Aperturar Orden'}</span>
                </button>
              )}
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};


