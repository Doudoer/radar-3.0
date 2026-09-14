import React, { useState, useEffect, useMemo } from 'react';
import { Order, OrderStatus, PrefillOrderData, Customer } from '../types';
import { INITIAL_CUSTOMERS } from '../data/customersData';
import { MAKE_MODEL_MAP } from '../data/carPartData';

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
  existingCustomers = INITIAL_CUSTOMERS,
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-md animate-fade-in">
      <div className="bg-[#111827] border border-[#1e293b] rounded-2xl w-full max-w-3xl max-h-[92vh] overflow-y-auto shadow-2xl flex flex-col custom-scrollbar">
        {/* Header con Título y Botón Cerrar */}
        <div className="p-4 sm:p-5 border-b border-[#1e293b] flex justify-between items-center bg-[#0b1329] sticky top-0 z-20">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-[#388bfd]/20 text-[#58a6ff] flex items-center justify-center border border-[#388bfd]/40 shadow-[0_0_12px_rgba(56,139,253,0.25)]">
              <span className="material-symbols-outlined text-[20px]">add_shopping_cart</span>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-base sm:text-lg text-[#f1f5f9] tracking-tight">
                  {editingOrder ? 'Editar Orden de Trabajo' : 'Crear Nueva Orden de Trabajo'}
                </h3>
                <span className="text-[10px] bg-[#388bfd]/20 text-[#58a6ff] border border-[#388bfd]/40 px-2 py-0.5 rounded-full font-mono font-bold">
                  Paso {currentStep} de 3
                </span>
              </div>
              <p className="text-xs text-[#94a3b8]">
                Asistente guiado: 1. Vehículo y Pieza → 2. Cliente → 3. Finanzas y Envío
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-[#94a3b8] hover:text-white p-1.5 rounded-lg hover:bg-[#1e293b] transition-colors cursor-pointer"
          >
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        {/* STEPPER NAVIGATION BAR */}
        <div className="bg-[#090e1a] border-b border-[#1e293b] px-4 py-3 sm:px-6">
          <div className="grid grid-cols-3 gap-2 relative">
            {stepsConfig.map((s) => {
              const isCompleted = s.num < currentStep;
              const isCurrent = s.num === currentStep;

              return (
                <button
                  type="button"
                  key={s.num}
                  onClick={() => {
                    // Permitir saltar hacia atrás o ir si ya se completó el anterior
                    if (s.num <= currentStep) {
                      setStepError(null);
                      setCurrentStep(s.num);
                    }
                  }}
                  className={`flex flex-col sm:flex-row items-center sm:items-start gap-2.5 p-2.5 rounded-xl transition-all text-left ${
                    isCurrent
                      ? 'bg-[#388bfd]/15 border border-[#388bfd]/40 shadow-sm'
                      : isCompleted
                      ? 'bg-[#10b981]/10 border border-[#10b981]/30 hover:bg-[#10b981]/20 cursor-pointer'
                      : 'bg-transparent border border-transparent opacity-40 cursor-not-allowed'
                  }`}
                >
                  <div
                    className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 text-xs font-bold font-mono transition-all ${
                      isCurrent
                        ? 'bg-[#388bfd] text-[#0a1120] shadow-[0_0_10px_rgba(56,139,253,0.5)]'
                        : isCompleted
                        ? 'bg-[#10b981] text-[#0a1120]'
                        : 'bg-[#1e293b] text-[#94a3b8]'
                    }`}
                  >
                    {isCompleted ? (
                      <span className="material-symbols-outlined text-[16px]">check</span>
                    ) : (
                      <span>{s.num}</span>
                    )}
                  </div>

                  <div className="hidden sm:block min-w-0">
                    <div className={`text-xs font-bold truncate ${isCurrent ? 'text-[#58a6ff]' : isCompleted ? 'text-[#34d399]' : 'text-[#94a3b8]'}`}>
                      {s.label}
                    </div>
                    <div className="text-[10px] text-[#64748b] truncate">{s.desc}</div>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Progress Line */}
          <div className="w-full bg-[#1e293b] h-1.5 rounded-full mt-3 overflow-hidden">
            <div
              className="bg-gradient-to-r from-[#388bfd] to-[#10b981] h-full transition-all duration-300 rounded-full"
              style={{ width: `${(currentStep / 3) * 100}%` }}
            />
          </div>
        </div>

        {/* Error Alert if any */}
        {stepError && (
          <div className="mx-5 sm:mx-6 mt-4 p-3 bg-[#ef4444]/15 border border-[#ef4444]/40 rounded-xl flex items-center gap-2.5 text-xs text-[#fca5a5] animate-shake">
            <span className="material-symbols-outlined text-[18px] text-[#ef4444]">error</span>
            <span>{stepError}</span>
          </div>
        )}

        {/* Car-Part Auto-Import Alert Banner (Si existe prefill) */}
        {initialPrefillData && currentStep === 1 && (
          <div className="mx-5 sm:mx-6 mt-4 bg-[#10b981]/15 border border-[#10b981]/40 rounded-xl p-3 flex items-start gap-3 shadow-lg animate-fade-in">
            <span className="material-symbols-outlined text-[#34d399] text-[20px] shrink-0 mt-0.5">
              bolt
            </span>
            <div className="flex-1 text-xs">
              <strong className="text-[#34d399] font-bold block">
                Datos Pre-cargados desde Car-Part / Registro
              </strong>
              <p className="text-[11px] text-[#e2e8f0] mt-0.5">
                Vehículo ({vehicleMake} {vehicleModel} {vehicleYear}), pieza cotizada (${partPrice}), VIN y stock #{stockNumber || 'STK'}.
              </p>
            </div>
          </div>
        )}

        {/* Form Body */}
        <form onSubmit={handleFormSubmit} className="p-5 sm:p-6 flex flex-col gap-6 text-xs text-[#cbd5e1]">
          {/* ========================================================================= */}
          {/* PASO 1: SOLICITUD DE DATOS DEL VEHÍCULO Y PIEZA */}
          {/* ========================================================================= */}
          {currentStep === 1 && (
            <div className="flex flex-col gap-5 animate-fade-in">
              <div className="flex items-center justify-between bg-[#0a0f1d] p-3 rounded-xl border border-[#1e293b]">
                <div className="flex items-center gap-2 text-[#58a6ff]">
                  <span className="material-symbols-outlined text-[18px]">directions_car</span>
                  <span className="font-bold text-xs uppercase tracking-wider">Paso 1: Datos del Vehículo & Pieza Solicitada</span>
                </div>
                <span className="text-[10px] text-[#94a3b8] font-mono">1 de 3</span>
              </div>

              {/* Ficha Técnica del Vehículo */}
              <div className="bg-[#0a0f1d] p-4 rounded-xl border border-[#1e293b] flex flex-col gap-3">
                <div className="flex items-center gap-2 text-xs font-bold text-[#f1f5f9] border-b border-[#1e293b]/70 pb-2">
                  <span className="material-symbols-outlined text-[16px] text-[#388bfd]">garage</span>
                  <span>Ficha Técnica del Vehículo</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block mb-1 text-[#94a3b8] font-medium">Año *</label>
                    <select
                      value={vehicleYear}
                      onChange={(e) => handleManualYearChange(e.target.value)}
                      className="w-full bg-[#111827] border border-[#1e293b] rounded-lg p-2.5 text-[#f1f5f9] font-mono focus:outline-none focus:border-[#388bfd] cursor-pointer"
                    >
                      <option value="">Selecciona año</option>
                      {yearOptions.map((year) => (
                        <option key={year} value={year}>{year}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block mb-1 text-[#94a3b8] font-medium">Marca *</label>
                    <select
                      value={vehicleMake}
                      onChange={(e) => handleManualMakeChange(e.target.value)}
                      disabled={!vehicleYear}
                      className="w-full bg-[#111827] border border-[#1e293b] rounded-lg p-2.5 text-[#f1f5f9] focus:outline-none focus:border-[#388bfd] disabled:opacity-50 cursor-pointer"
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
                    <label className="block mb-1 text-[#94a3b8] font-medium">Modelo *</label>
                    <select
                      required
                      autoFocus
                      value={vehicleModel}
                      onChange={(e) => {
                        setVehicleModel(e.target.value);
                        if (stepError) setStepError(null);
                      }}
                      disabled={!vehicleMake}
                      className="w-full bg-[#111827] border border-[#1e293b] rounded-lg p-2.5 text-[#f1f5f9] focus:outline-none focus:border-[#388bfd] disabled:opacity-50 cursor-pointer"
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
                    <label className="block mb-1 text-[#94a3b8] font-medium">Número de Serie (VIN - 17 Dígitos)</label>
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
                      className="w-full bg-[#111827] border border-[#1e293b] rounded-lg p-2.5 text-[#f1f5f9] font-mono uppercase tracking-wider focus:outline-none focus:border-[#388bfd]"
                    />
                    <span className={`mt-1 block text-[10px] font-medium ${
                      vinDecodeStatus === 'error' ? 'text-[#f87171]' : vinDecodeStatus === 'success' ? 'text-[#34d399]' : 'text-[#64748b]'
                    }`}>
                      {vinDecodeMessage || 'Se decodifica automáticamente al completar 17 caracteres'}
                    </span>
                  </div>

                  <div>
                    <label className="block mb-1 text-[#94a3b8] font-medium">Millaje Reportado *</label>
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
                      className="w-full bg-[#111827] border border-[#1e293b] rounded-lg p-2.5 text-[#f1f5f9] font-mono focus:outline-none focus:border-[#388bfd]"
                    />
                  </div>
                </div>
              </div>

              {/* Pieza & Refacción Solicitada */}
              <div className="bg-[#0a0f1d] p-4 rounded-xl border border-[#1e293b] flex flex-col gap-3">
                <div className="flex items-center gap-2 text-xs font-bold text-[#f1f5f9] border-b border-[#1e293b]/70 pb-2">
                  <span className="material-symbols-outlined text-[16px] text-[#fbbf24]">settings</span>
                  <span>Pieza Solicitada & Datos de Yarda / Stock</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="sm:col-span-2">
                    <label className="block mb-1 text-[#94a3b8] font-medium">Pieza Principal Solicitada *</label>
                    <select
                      required
                      value={mainPart}
                      onChange={(e) => {
                        setMainPart(e.target.value);
                        if (stepError) setStepError(null);
                      }}
                      className="w-full bg-[#111827] border border-[#1e293b] rounded-lg p-2.5 text-[#f1f5f9] font-medium focus:outline-none focus:border-[#388bfd]"
                    >
                      <option value="">Seleccionar tipo</option>
                      <option value="Engine">Engine</option>
                      <option value="Transmission">Transmission</option>
                    </select>
                  </div>

                  <div>
                    <label className="block mb-1 text-[#94a3b8] font-medium">Stock # (Yarda / Proveedor) *</label>
                    <input
                      type="text"
                      required
                      value={stockNumber}
                      onChange={(e) => {
                        setStockNumber(e.target.value);
                        if (stepError) setStepError(null);
                      }}
                      placeholder="STK-RDZ-4491"
                      className="w-full bg-[#111827] border border-[#1e293b] rounded-lg p-2.5 text-[#f1f5f9] font-mono focus:outline-none focus:border-[#388bfd]"
                    />
                  </div>

                  <div className="sm:col-span-3">
                    <label className="block mb-1 text-[#94a3b8] font-medium">Especificaciones Técnicas / Interchange Notes</label>
                    <input
                      type="text"
                      value={productSpecs}
                      onChange={(e) => setProductSpecs(e.target.value)}
                      placeholder="Ej. 2.7L Turbo VIN P, RUNS GREAT TESTED, COMPRESSION 175 PSI, OEM spec"
                      className="w-full bg-[#111827] border border-[#1e293b] rounded-lg p-2.5 text-[#f1f5f9] text-xs focus:outline-none focus:border-[#388bfd]"
                    />
                  </div>

                  <div className="sm:col-span-3">
                    <label className="block mb-1 text-[#94a3b8] font-medium">Notas de Búsqueda / Yarda / Instrucciones Internas</label>
                    <textarea
                      rows={2}
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder="Observaciones de compra, contacto del desguace, instrucciones de embalaje..."
                      className="w-full bg-[#111827] border border-[#1e293b] rounded-lg p-2.5 text-[#f1f5f9] text-xs focus:outline-none focus:border-[#388bfd]"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ========================================================================= */}
          {/* PASO 2: LLENAR DATOS DEL CLIENTE / SELECCIONAR CLIENTE EXISTENTE */}
          {/* ========================================================================= */}
          {currentStep === 2 && (
            <div className="flex flex-col gap-4 animate-fade-in">
              {/* Header del Paso 2 */}
              <div className="flex items-center justify-between bg-[#0a0f1d] p-3 rounded-xl border border-[#1e293b]">
                <div className="flex items-center gap-2 text-[#34d399]">
                  <span className="material-symbols-outlined text-[18px]">person</span>
                  <span className="font-bold text-xs uppercase tracking-wider">Paso 2: Datos del Cliente & Despacho</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-[#94a3b8] font-mono">2 de 3</span>
                </div>
              </div>

              {/* Selector de Modo: Buscar Existente vs Nuevo Manual */}
              <div className="flex items-center bg-[#0d1527] p-1 rounded-xl border border-[#1e293b] gap-1">
                <button
                  type="button"
                  onClick={() => {
                    setClientMode('search');
                    if (stepError) setStepError(null);
                  }}
                  className={`flex-1 py-2 px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-2 transition-all cursor-pointer ${
                    clientMode === 'search'
                      ? 'bg-[#388bfd] text-white shadow-md'
                      : 'text-[#94a3b8] hover:text-[#f1f5f9] hover:bg-[#1e293b]/40'
                  }`}
                >
                  <span className="material-symbols-outlined text-[16px]">contacts</span>
                  <span>Seleccionar Cliente Existente (CRM)</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                    clientMode === 'search' ? 'bg-white/20 text-white' : 'bg-[#1e293b] text-[#94a3b8]'
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
                  className={`flex-1 py-2 px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-2 transition-all cursor-pointer ${
                    clientMode === 'manual'
                      ? 'bg-[#388bfd] text-white shadow-md'
                      : 'text-[#94a3b8] hover:text-[#f1f5f9] hover:bg-[#1e293b]/40'
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
                    <div className="bg-[#0b192e] border-2 border-[#388bfd]/60 rounded-xl p-4 flex flex-col gap-3 shadow-lg">
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-3">
                          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-[#388bfd] to-[#10b981] text-white font-bold text-base flex items-center justify-center shadow-md">
                            {selectedCustomerObj.initials || selectedCustomerObj.name.substring(0, 2).toUpperCase()}
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <h4 className="font-bold text-sm text-[#f1f5f9]">
                                {selectedCustomerObj.name}
                              </h4>
                              <span className="text-[10px] bg-[#34d399]/20 text-[#34d399] border border-[#34d399]/40 px-2 py-0.5 rounded-full font-bold flex items-center gap-1">
                                <span className="material-symbols-outlined text-[12px]">verified</span>
                                Cliente CRM Vinculado
                              </span>
                            </div>
                            {selectedCustomerObj.company && (
                              <p className="text-xs text-[#94a3b8] font-medium flex items-center gap-1 mt-0.5">
                                <span className="material-symbols-outlined text-[13px] text-[#fbbf24]">domain</span>
                                {selectedCustomerObj.company}
                              </p>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setSelectedCustomerId(null)}
                            className="px-2.5 py-1.5 text-xs bg-[#1e293b] hover:bg-[#334155] text-[#cbd5e1] rounded-lg border border-[#334155] flex items-center gap-1 cursor-pointer transition-colors"
                          >
                            <span className="material-symbols-outlined text-[14px]">swap_horiz</span>
                            <span>Cambiar</span>
                          </button>
                          <button
                            type="button"
                            onClick={handleClearCustomerSelection}
                            className="p-1.5 text-xs bg-[#ef4444]/15 hover:bg-[#ef4444]/25 text-[#f87171] rounded-lg border border-[#ef4444]/30 cursor-pointer transition-colors"
                            title="Desvincular cliente"
                          >
                            <span className="material-symbols-outlined text-[16px]">close</span>
                          </button>
                        </div>
                      </div>

                      {/* Detalles de Contacto Resumidos */}
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 bg-[#091122] p-3 rounded-lg border border-[#1e293b]/70 text-xs">
                        <div className="flex items-center gap-2">
                          <span className="material-symbols-outlined text-[15px] text-[#34d399]">call</span>
                          <span className="font-mono text-[#e2e8f0] font-medium">{customerPhone || 'Sin teléfono'}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="material-symbols-outlined text-[15px] text-[#58a6ff]">mail</span>
                          <span className="text-[#cbd5e1] truncate">{customerEmail || 'Sin email'}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="material-symbols-outlined text-[15px] text-[#fbbf24]">badge</span>
                          <span className="text-[#e2e8f0] font-medium">{customerType}</span>
                        </div>
                      </div>

                      {/* Dirección de despacho editable */}
                      <div className="bg-[#091122] p-3 rounded-lg border border-[#1e293b]/70 flex flex-col gap-2">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1.5 text-xs font-bold text-[#f1f5f9]">
                            <span className="material-symbols-outlined text-[15px] text-[#f43f5e]">local_shipping</span>
                            <span>Dirección de Despacho para esta Orden</span>
                          </div>
                          <span className="text-[10px] text-[#94a3b8]">(Editable para este pedido)</span>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                          <div className="sm:col-span-2">
                            <input
                              type="text"
                              value={shippingAddress}
                              onChange={(e) => setShippingAddress(e.target.value)}
                              placeholder="Dirección completa de entrega o taller"
                              className="w-full bg-[#111827] border border-[#1e293b] rounded-lg p-2 text-[#f1f5f9] text-xs focus:outline-none focus:border-[#388bfd]"
                            />
                          </div>
                          <div>
                            <input
                              type="text"
                              value={zipCode}
                              onChange={(e) => setZipCode(e.target.value)}
                              placeholder="ZIP (Ej. 27520)"
                              className="w-full bg-[#111827] border border-[#1e293b] rounded-lg p-2 text-[#f1f5f9] font-mono text-xs focus:outline-none focus:border-[#388bfd]"
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    /* SI NO HAY CLIENTE SELECCIONADO: Buscador & Lista de Clientes */
                    <div className="bg-[#0a0f1d] p-4 rounded-xl border border-[#1e293b] flex flex-col gap-3">
                      {/* Barra de Búsqueda */}
                      <div className="relative">
                        <span className="material-symbols-outlined absolute left-3 top-2.5 text-[#64748b] text-[18px]">
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
                          className="w-full bg-[#111827] border border-[#1e293b] rounded-xl py-2.5 pl-9 pr-8 text-xs text-[#f1f5f9] placeholder:text-[#64748b] focus:outline-none focus:border-[#388bfd] shadow-inner"
                        />
                        {clientSearchQuery && (
                          <button
                            type="button"
                            onClick={() => setClientSearchQuery('')}
                            className="absolute right-2.5 top-2.5 text-[#64748b] hover:text-[#cbd5e1] cursor-pointer"
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
                            className={`px-2.5 py-1 rounded-lg text-[11px] font-medium whitespace-nowrap transition-all cursor-pointer ${
                              selectedCategoryFilter === cat.id
                                ? 'bg-[#388bfd] text-white shadow-sm'
                                : 'bg-[#111827] text-[#94a3b8] hover:text-[#cbd5e1] border border-[#1e293b]'
                            }`}
                          >
                            {cat.label}
                          </button>
                        ))}
                      </div>

                      {/* Clientes Frecuentes / Atajos Rápidos */}
                      {!clientSearchQuery && (
                        <div className="flex flex-col gap-1.5 pt-1">
                          <span className="text-[10px] text-[#64748b] uppercase tracking-wider font-bold">
                            Clientes Frecuentes Sugeridos
                          </span>
                          <div className="flex flex-wrap gap-1.5">
                            {existingCustomers.slice(0, 5).map((quickCust) => (
                              <button
                                key={quickCust.id}
                                type="button"
                                onClick={() => handleSelectCustomer(quickCust)}
                                className="px-2.5 py-1 rounded-lg bg-[#111827] hover:bg-[#388bfd]/20 hover:border-[#388bfd]/50 border border-[#1e293b] text-[#cbd5e1] text-[11px] flex items-center gap-1.5 transition-all cursor-pointer"
                              >
                                <span className="w-2 h-2 rounded-full bg-[#34d399]" />
                                <span className="font-medium">{quickCust.name}</span>
                                <span className="text-[9px] text-[#64748b]">({quickCust.type})</span>
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
                                className={`p-2.5 rounded-xl border flex items-center justify-between gap-3 cursor-pointer transition-all ${
                                  isSelected
                                    ? 'bg-[#388bfd]/20 border-[#388bfd] text-white shadow-sm'
                                    : 'bg-[#111827]/80 hover:bg-[#1e293b] border-[#1e293b] text-[#cbd5e1]'
                                }`}
                              >
                                <div className="flex items-center gap-2.5 min-w-0">
                                  <div className="w-8 h-8 rounded-lg bg-[#1e293b] border border-[#334155] text-[#58a6ff] font-bold text-xs flex items-center justify-center shrink-0">
                                    {cust.initials || cust.name.substring(0, 2).toUpperCase()}
                                  </div>
                                  <div className="min-w-0">
                                    <div className="flex items-center gap-1.5">
                                      <span className="font-bold text-xs text-[#f1f5f9] truncate">
                                        {cust.name}
                                      </span>
                                      <span className={`text-[9px] px-1.5 py-0.2 rounded font-bold shrink-0 ${
                                        cust.type === 'VIP'
                                          ? 'bg-[#a78bfa]/20 text-[#c4b5fd]'
                                          : cust.type === 'Taller Mecánico'
                                          ? 'bg-[#34d399]/20 text-[#6ee7b7]'
                                          : cust.type === 'Flota Mantenimiento'
                                          ? 'bg-[#fbbf24]/20 text-[#fcd34d]'
                                          : 'bg-[#64748b]/20 text-[#cbd5e1]'
                                      }`}>
                                        {cust.type}
                                      </span>
                                    </div>
                                    <div className="text-[11px] text-[#94a3b8] flex items-center gap-2 truncate mt-0.5">
                                      {cust.company && <span className="text-[#e2e8f0]">{cust.company} •</span>}
                                      <span>{cust.phone}</span>
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
                                  className="px-3 py-1.5 bg-[#388bfd]/20 hover:bg-[#388bfd] text-[#58a6ff] hover:text-white rounded-lg text-xs font-semibold border border-[#388bfd]/40 transition-all shrink-0 cursor-pointer flex items-center gap-1"
                                >
                                  <span className="material-symbols-outlined text-[14px]">check</span>
                                  <span>Seleccionar</span>
                                </button>
                              </div>
                            );
                          })
                        ) : (
                          <div className="p-6 text-center text-[#94a3b8] flex flex-col items-center gap-2 bg-[#111827]/40 rounded-xl border border-dashed border-[#1e293b]">
                            <span className="material-symbols-outlined text-[28px] text-[#64748b]">person_search</span>
                            <p className="text-xs">
                              No se encontraron clientes con el criterio &quot;{clientSearchQuery}&quot;.
                            </p>
                            <button
                              type="button"
                              onClick={() => {
                                setCustomerName(clientSearchQuery);
                                setClientMode('manual');
                              }}
                              className="mt-1 px-3 py-1.5 bg-[#388bfd] hover:bg-[#2f81f7] text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 cursor-pointer shadow-sm"
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
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-[#0a0f1d] p-4 rounded-xl border border-[#1e293b]">
                  <div>
                    <label className="block mb-1 text-[#94a3b8] font-medium">Nombre Completo / Razón Social *</label>
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
                      className="w-full bg-[#111827] border border-[#1e293b] rounded-lg p-2.5 text-[#f1f5f9] focus:outline-none focus:border-[#388bfd] transition-colors"
                    />
                  </div>

                  <div>
                    <label className="block mb-1 text-[#94a3b8] font-medium">Tipo de Cliente</label>
                    <select
                      value={customerType}
                      onChange={(e) => setCustomerType(e.target.value as any)}
                      className="w-full bg-[#111827] border border-[#1e293b] rounded-lg p-2.5 text-[#f1f5f9] focus:outline-none focus:border-[#388bfd] transition-colors cursor-pointer"
                    >
                      <option value="Particular">Particular (Cliente Directo)</option>
                      <option value="Taller Mecánico">Taller Mecánico Aliado</option>
                      <option value="Empresa">Empresa / Corporativo</option>
                      <option value="Flota Mantenimiento">Flota Mantenimiento</option>
                      <option value="VIP">Cliente VIP (Trato Preferencial)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block mb-1 text-[#94a3b8] font-medium">Teléfono / WhatsApp de Contacto *</label>
                    <input
                      type="text"
                      value={customerPhone}
                      onChange={(e) => setCustomerPhone(e.target.value)}
                      placeholder="+1 (919) 555-0188"
                      className="w-full bg-[#111827] border border-[#1e293b] rounded-lg p-2.5 text-[#f1f5f9] font-mono focus:outline-none focus:border-[#388bfd] transition-colors"
                    />
                  </div>

                  <div>
                    <label className="block mb-1 text-[#94a3b8] font-medium">Correo Electrónico (Notificaciones)</label>
                    <input
                      type="email"
                      value={customerEmail}
                      onChange={(e) => setCustomerEmail(e.target.value)}
                      placeholder="cliente@ejemplo.com"
                      className="w-full bg-[#111827] border border-[#1e293b] rounded-lg p-2.5 text-[#f1f5f9] focus:outline-none focus:border-[#388bfd] transition-colors"
                    />
                  </div>

                  <div className="sm:col-span-2 grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
                    <div className="sm:col-span-2">
                      <label className="block mb-1 text-[#94a3b8] font-medium">Dirección de Despacho / Taller</label>
                      <input
                        type="text"
                        value={shippingAddress}
                        onChange={(e) => setShippingAddress(e.target.value)}
                        placeholder="Calle, Número, Taller / Local, Ciudad"
                        className="w-full bg-[#111827] border border-[#1e293b] rounded-lg p-2.5 text-[#f1f5f9] focus:outline-none focus:border-[#388bfd] transition-colors"
                      />
                    </div>
                    <div>
                      <label className="block mb-1 text-[#94a3b8] font-medium">Código Postal (ZIP)</label>
                      <input
                        type="text"
                        value={zipCode}
                        onChange={(e) => setZipCode(e.target.value)}
                        placeholder="Ej. 27520"
                        className="w-full bg-[#111827] border border-[#1e293b] rounded-lg p-2.5 text-[#f1f5f9] font-mono focus:outline-none focus:border-[#388bfd] transition-colors"
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ========================================================================= */}
          {/* PASO 3: FINANZAS Y ENVÍO */}
          {/* ========================================================================= */}
          {currentStep === 3 && (
            <div className="flex flex-col gap-4 animate-fade-in">
              <div className="flex items-center justify-between bg-[#0a0f1d] p-3 rounded-xl border border-[#1e293b]">
                <div className="flex items-center gap-2 text-[#a78bfa]">
                  <span className="material-symbols-outlined text-[18px]">account_balance_wallet</span>
                  <span className="font-bold text-xs uppercase tracking-wider">Paso 3: Finanzas, Envío & Liquidación</span>
                </div>
                <span className="text-[10px] text-[#94a3b8] font-mono">3 de 3</span>
              </div>

              {/* Inputs de Desglose */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-[#0a0f1d] p-4 rounded-xl border border-[#1e293b]">
                <div>
                  <label className="block mb-1 text-[#58a6ff] font-semibold text-[11px]">1. Monto Parte ($ USD) *</label>
                  <div className="relative">
                    <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#58a6ff] font-bold text-xs">$</span>
                    <input
                      type="number"
                      min={0}
                      step="any"
                      autoFocus
                      value={partPrice}
                      onChange={(e) => handlePriceChange(e.target.value)}
                      placeholder="0.00"
                      className="w-full bg-[#111827] border border-[#388bfd]/50 rounded-lg py-2 pl-7 pr-2 font-mono text-[#58a6ff] font-bold text-xs focus:outline-none focus:border-[#388bfd]"
                    />
                  </div>
                </div>

                <div>
                  <label className="block mb-1 text-[#f59e0b] font-semibold text-[11px]">2. Abono / Downpayment ($)</label>
                  <div className="relative">
                    <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#f59e0b] font-bold text-xs">$</span>
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
                      className="w-full bg-[#111827] border border-[#f59e0b]/50 rounded-lg py-2 pl-7 pr-2 font-mono text-[#f59e0b] font-bold text-xs focus:outline-none focus:border-[#f59e0b]"
                    />
                  </div>
                </div>

                <div>
                  <label className="block mb-1 text-[#94a3b8] font-semibold text-[11px]">3. Flete / Delivery ($)</label>
                  <div className="relative">
                    <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#94a3b8] font-bold text-xs">$</span>
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
                      className="w-full bg-[#111827] border border-[#1e293b] rounded-lg py-2 pl-7 pr-2 font-mono text-[#f1f5f9] font-bold text-xs focus:outline-none focus:border-[#388bfd] disabled:opacity-40"
                    />
                  </div>
                </div>

                <div>
                  <label className="block mb-1 text-[#94a3b8] font-semibold text-[11px]">4. Depósito Core Fee ($)</label>
                  <div className="relative">
                    <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#94a3b8] font-bold text-xs">$</span>
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
                      className="w-full bg-[#111827] border border-[#1e293b] rounded-lg py-2 pl-7 pr-2 font-mono text-[#f1f5f9] font-bold text-xs focus:outline-none focus:border-[#388bfd]"
                    />
                  </div>
                </div>
              </div>

              {/* Total Balance Calculation Bar */}
              <div className="bg-[#111827] p-4 rounded-xl border border-[#388bfd]/30 flex flex-col sm:flex-row items-center justify-between gap-3 shadow-inner">
                <div className="flex items-center gap-4 text-xs">
                  <div>
                    <span className="text-[#94a3b8] block text-[10px] uppercase">Subtotal Bruto:</span>
                    <span className="font-mono font-bold text-[#f1f5f9] text-sm">${grossSubtotal.toFixed(2)}</span>
                  </div>
                  <span className="text-[#64748b] text-lg font-light">-</span>
                  <div>
                    <span className="text-[#f59e0b] block text-[10px] uppercase">Anticipo Pagado:</span>
                    <span className="font-mono font-bold text-[#f59e0b] text-sm">${numDown.toFixed(2)}</span>
                  </div>
                  <span className="text-[#64748b] text-lg font-light">=</span>
                </div>

                <div className="text-right">
                  <span className="text-[10px] text-[#34d399] uppercase font-bold tracking-wider block">
                    Saldo Restante al Despachar (Balance Due):
                  </span>
                  <span className="text-xl sm:text-2xl font-black font-mono text-[#58a6ff] drop-shadow-[0_0_10px_rgba(56,139,253,0.5)]">
                    ${balanceDue.toFixed(2)} <span className="text-xs font-normal text-[#94a3b8]">USD</span>
                  </span>
                </div>
              </div>

              {/* Políticas de Entrega y Garantía */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-[#0a0f1d] p-4 rounded-xl border border-[#1e293b]">
                <div>
                  <label className="block mb-1 text-[#94a3b8] font-semibold text-xs">Tipo de Entrega / Despacho</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setDeliveryType('retiro_tienda');
                      }}
                      className={`py-2 px-3 rounded-lg border text-xs font-bold flex items-center justify-center gap-2 transition-all cursor-pointer ${
                        deliveryType === 'retiro_tienda'
                          ? 'bg-[#10b981]/20 border-[#10b981] text-[#34d399] shadow-[0_0_10px_rgba(16,185,129,0.2)]'
                          : 'bg-[#111827] border-[#1e293b] text-[#94a3b8] hover:text-[#f1f5f9]'
                      }`}
                    >
                      <span className="material-symbols-outlined text-[16px]">storefront</span>
                      <span>Retiro en Patio ($0)</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setDeliveryType('envio_domicilio');
                      }}
                      className={`py-2 px-3 rounded-lg border text-xs font-bold flex items-center justify-center gap-2 transition-all cursor-pointer ${
                        deliveryType === 'envio_domicilio'
                          ? 'bg-[#388bfd]/20 border-[#388bfd] text-[#58a6ff] shadow-[0_0_10px_rgba(56,139,253,0.2)]'
                          : 'bg-[#111827] border-[#1e293b] text-[#94a3b8] hover:text-[#f1f5f9]'
                      }`}
                    >
                      <span className="material-symbols-outlined text-[16px]">local_shipping</span>
                      <span>Envío a Domicilio</span>
                    </button>
                  </div>
                </div>

                {deliveryType === 'envio_domicilio' && (
                  <div className="sm:col-span-2 order-last">
                    <label className="block mb-1 text-[#58a6ff] font-semibold text-xs">Dirección de Envío a Domicilio *</label>
                    <div className="grid grid-cols-1 sm:grid-cols-[1fr_130px] gap-2">
                      <input
                        type="text"
                        value={shippingAddress}
                        onChange={(e) => {
                          setShippingAddress(e.target.value);
                          if (stepError) setStepError(null);
                        }}
                        placeholder="Calle, número, ciudad, estado"
                        className="w-full bg-[#111827] border border-[#388bfd]/50 rounded-lg p-2.5 text-[#f1f5f9] focus:outline-none focus:border-[#388bfd]"
                      />
                      <input
                        type="text"
                        value={zipCode}
                        onChange={(e) => setZipCode(e.target.value)}
                        placeholder="ZIP"
                        className="w-full bg-[#111827] border border-[#1e293b] rounded-lg p-2.5 text-[#f1f5f9] font-mono focus:outline-none focus:border-[#388bfd]"
                      />
                    </div>
                    <p className="mt-1 text-[10px] text-[#94a3b8]">Esta dirección se almacena junto con la orden y se usa para despacho.</p>
                  </div>
                )}

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-[#94a3b8] font-semibold text-xs">
                      Garantía (Auto-asignada según precio)
                    </label>
                    <span className="text-[10px] text-[#34d399] font-mono font-semibold">
                      {warrantyDays} Días Activa
                    </span>
                  </div>
                  <div className="rounded-lg border border-[#1e293b] bg-[#111827] px-3 py-2 text-xs text-[#cbd5e1]">
                    <span className="font-mono font-bold text-[#34d399]">{warrantyDays} días</span>
                    <span className="ml-2 text-[#94a3b8]">calculados por monto de parte</span>
                  </div>
                </div>
              </div>

              {/* Asesor y Estatus Inicial */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-[#0a0f1d] p-4 rounded-xl border border-[#1e293b]">
                <div>
                  <label className="block mb-1 text-[#94a3b8] text-xs font-semibold">Asesor Comercial Asignado</label>
                  <select
                    value={advisor}
                    onChange={(e) => setAdvisor(e.target.value)}
                    className="w-full bg-[#111827] border border-[#1e293b] rounded-lg p-2.5 text-[#f1f5f9] focus:outline-none focus:border-[#388bfd]"
                  >
                    <option value="Carlos Mendoza (Ventas)">Carlos Mendoza (Ventas)</option>
                    <option value="Alejandro Morales (Ventas)">Alejandro Morales (Ventas)</option>
                    <option value="Laura Méndez (Call Center)">Laura Méndez (Call Center)</option>
                    <option value="Douglas Villalobos (Admin)">Douglas Villalobos (Admin)</option>
                  </select>
                </div>

                <div>
                  <label className="block mb-1 text-[#94a3b8] text-xs font-semibold">Estatus Inicial de Apertura</label>
                  <div className="rounded-lg border border-[#388bfd]/40 bg-[#388bfd]/10 px-3 py-2 text-xs font-bold text-[#58a6ff]">
                    Cotización
                  </div>
                </div>
              </div>

              {/* Resumen Final de la Orden */}
              <div className="bg-[#0b1329] border border-[#388bfd]/30 rounded-xl p-3.5 flex items-center justify-between text-xs">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-[#388bfd]/20 text-[#58a6ff] flex items-center justify-center">
                    <span className="material-symbols-outlined text-[18px]">verified</span>
                  </div>
                  <div>
                    <div className="text-[#f1f5f9] font-bold">{customerName || 'Cliente'} — {vehicleMake} {vehicleModel} {vehicleYear}</div>
                    <div className="text-[11px] text-[#94a3b8]">{mainPart} • Garantía {warrantyDays} días • {deliveryType === 'retiro_tienda' ? 'Retiro en Patio' : 'Envío a Domicilio'}</div>
                  </div>
                </div>
                <div className="text-right">
                  <span className="text-[10px] text-[#94a3b8] uppercase block">Total a Pagar</span>
                  <span className="text-base font-bold font-mono text-[#34d399]">${grossSubtotal.toFixed(2)}</span>
                </div>
              </div>
            </div>
          )}

          {/* STEPPER FOOTER CONTROLS */}
          <div className="pt-3 border-t border-[#1e293b] flex items-center justify-between gap-3 bg-[#0b1329] -mx-5 -mb-5 sm:-mx-6 sm:-mb-6 p-4 rounded-b-2xl sticky bottom-0 z-10">
            <div>
              {currentStep > 1 ? (
                <button
                  type="button"
                  onClick={handlePrev}
                  className="px-4 py-2 rounded-lg bg-[#1e293b] hover:bg-[#334155] text-[#cbd5e1] font-semibold text-xs flex items-center gap-1.5 transition-all cursor-pointer active:scale-95"
                >
                  <span className="material-symbols-outlined text-[16px]">arrow_back</span>
                  <span>Anterior</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onClose}
                  className="px-3.5 py-2 rounded-lg bg-[#1e293b] hover:bg-[#334155] text-[#94a3b8] hover:text-white transition-colors cursor-pointer text-xs font-semibold"
                >
                  Cancelar
                </button>
              )}
            </div>

            <div className="flex items-center gap-2">
              <span className="text-[11px] text-[#64748b] hidden sm:inline font-mono">
                Paso {currentStep} de 3
              </span>

              {currentStep < 3 ? (
                <button
                  type="button"
                  onClick={validateAndNext}
                  className="px-5 py-2.5 rounded-lg bg-[#388bfd] hover:bg-[#2563eb] text-[#0a1120] font-bold transition-all shadow-[0_0_12px_rgba(56,139,253,0.3)] cursor-pointer active:scale-95 flex items-center gap-1.5 text-xs"
                >
                  <span>Siguiente Paso</span>
                  <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleSubmit}
                  className="px-5 py-2.5 rounded-lg bg-[#10b981] hover:bg-[#059669] text-[#0a1120] font-black transition-all shadow-[0_0_15px_rgba(16,185,129,0.4)] cursor-pointer active:scale-95 flex items-center gap-2 text-xs"
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


