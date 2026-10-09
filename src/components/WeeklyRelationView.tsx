import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Order } from '../types';
import { apiFetch } from '../services/apiFetch';
import {
  generateOfficialDeliveriesPdf,
  generateWeeklySalesPdf,
  generateGeneralRelationPdf,
  downloadPdfBytes,
} from '../utils/weeklyRelationPdf';

export interface OfficeEmployee {
  id: string;
  name: string;
  weeklySalary: number;
  role?: string;
}

export interface RecurringExpense {
  id: string;
  name: string;
  category:
    | 'Nómina / Pago de Empleados'
    | 'Alquiler de Oficina / Patio'
    | 'Servicios (Luz / Agua / Internet)'
    | 'Suministros y Papelería'
    | 'Mantenimiento y Limpieza'
    | 'Gastos Administrativos'
    | 'Varios';
  amount: number;
  frequency: 'monthly' | 'weekly';
  monthlyDay?: number; // e.g. 30 (or last day of month if shorter)
  advanceIfWeekend?: boolean; // if due day is Fri, Sat, or Sun, advance to previous week
  active: boolean;
  notes?: string;
  paymentMethod: 'Transferencia' | 'Zelle' | 'Efectivo' | 'Tarjeta';
}

export interface ExpenseItem {
  id: string;
  description: string;
  category:
    | 'Nómina / Personal'
    | 'Comisiones y Bonificaciones'
    | 'Alquiler de Oficina / Patio'
    | 'Servicios (Luz / Agua / Internet)'
    | 'Suministros y Papelería'
    | 'Mantenimiento y Limpieza'
    | 'Gastos Administrativos'
    | 'Varios';
  amount: number;
  date: string;
  paymentMethod: 'Transferencia' | 'Zelle' | 'Efectivo' | 'Tarjeta';
  receiptNr?: string;
}

interface WeeklyRelationViewProps {
  orders?: Order[];
  onBackToDashboard?: () => void;
}

/**
 * Utility to calculate the Monday 00:00:00 and Sunday 23:59:59 of a given reference date
 */
export const getWeekRange = (refDate = new Date()) => {
  const d = new Date(refDate);
  const day = d.getDay(); // 0 is Sunday, 1 is Monday... 6 is Saturday
  const diffToMonday = day === 0 ? -6 : 1 - day;

  const monday = new Date(d);
  monday.setDate(d.getDate() + diffToMonday);
  monday.setHours(0, 0, 0, 0);

  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);

  return { start: monday, end: sunday };
};

/**
 * Robust date parser supporting ISO strings, YYYY-MM-DD, DD/MM/YYYY, timestamps, etc.
 */
export const parseDateSafe = (dateVal?: string | null): Date | null => {
  if (!dateVal) return null;
  const str = String(dateVal).trim();
  if (!str) return null;

  // Try direct parse
  const direct = new Date(str);
  if (!isNaN(direct.getTime())) {
    return direct;
  }

  // Try slash-separated DD/MM/YYYY
  if (str.includes('/')) {
    const parts = str.split(' ')[0].split('/');
    if (parts.length === 3) {
      const p0 = parseInt(parts[0], 10);
      const p1 = parseInt(parts[1], 10) - 1;
      const p2 = parseInt(parts[2], 10);
      if (parts[2].length === 4) {
        const d = new Date(p2, p1, p0);
        if (!isNaN(d.getTime())) return d;
      }
    }
  }

  return null;
};

/**
 * Checks if a date falls strictly within the specified week range
 */
export const isDateInWeek = (dateVal?: string | null, weekRange = getWeekRange()): boolean => {
  const d = parseDateSafe(dateVal);
  if (!d) return false;
  return d >= weekRange.start && d <= weekRange.end;
};

/**
 * Calculates the exact week [start, end] when a monthly recurring expense is due for a given month/year.
 *
 * Rules:
 * 1. Base due day: targetDay (e.g. 30), or the last day of the month if shorter (e.g. Feb 28).
 * 2. If advanceIfWeekend is true AND that day falls on Friday (5), Saturday (6), or Sunday (0):
 *    The due week is shifted to the PREVIOUS week (7 days before the current week's Monday).
 * 3. Otherwise, the due week is the week containing that due day.
 */
export const getMonthlyRecurringDueWeek = (
  year: number,
  month: number, // 0-indexed: 0 = Jan, 1 = Feb, etc.
  targetDay = 30,
  advanceIfWeekend = true
): { start: Date; end: Date; rawDueDate: Date; wasAdvanced: boolean } => {
  const lastDayOfMonth = new Date(year, month + 1, 0).getDate();
  const effectiveDay = Math.min(targetDay, lastDayOfMonth);

  const rawDueDate = new Date(year, month, effectiveDay, 12, 0, 0, 0);
  const dayOfWeek = rawDueDate.getDay(); // 0 = Sun, 1 = Mon, ..., 5 = Fri, 6 = Sat

  const isWeekendOrFriday = dayOfWeek === 5 || dayOfWeek === 6 || dayOfWeek === 0;

  if (advanceIfWeekend && isWeekendOrFriday) {
    const baseWeek = getWeekRange(rawDueDate);
    const prevWeekRef = new Date(baseWeek.start);
    prevWeekRef.setDate(prevWeekRef.getDate() - 7);
    const prevWeek = getWeekRange(prevWeekRef);
    return { ...prevWeek, rawDueDate, wasAdvanced: true };
  }

  const normalWeek = getWeekRange(rawDueDate);
  return { ...normalWeek, rawDueDate, wasAdvanced: false };
};

/**
 * Checks if a recurring expense should be charged in the given week range.
 */
export const isRecurringExpenseDueInWeek = (
  expense: RecurringExpense,
  weekRange = getWeekRange()
): boolean => {
  if (!expense.active) return false;

  if (expense.frequency === 'weekly') {
    return true;
  }

  if (expense.frequency === 'monthly') {
    const yearStart = weekRange.start.getFullYear();
    const monthStart = weekRange.start.getMonth();

    const candidateMonths = [
      { year: yearStart, month: monthStart },
      { year: monthStart === 11 ? yearStart + 1 : yearStart, month: (monthStart + 1) % 12 },
      { year: monthStart === 0 ? yearStart - 1 : yearStart, month: (monthStart + 11) % 12 },
    ];

    for (const { year, month } of candidateMonths) {
      const dueInfo = getMonthlyRecurringDueWeek(
        year,
        month,
        expense.monthlyDay ?? 30,
        expense.advanceIfWeekend ?? true
      );

      if (
        dueInfo.start.getFullYear() === weekRange.start.getFullYear() &&
        dueInfo.start.getMonth() === weekRange.start.getMonth() &&
        dueInfo.start.getDate() === weekRange.start.getDate()
      ) {
        return true;
      }
    }
  }

  return false;
};

export const DEFAULT_EMPLOYEES: OfficeEmployee[] = [
  { id: 'EMP-04', name: 'Douglas', weeklySalary: 150.0, role: 'Supervisor' },
  { id: 'EMP-05', name: 'Favio', weeklySalary: 120.0, role: 'Asesor Comercial' },
  { id: 'EMP-02', name: 'Williana', weeklySalary: 90.0, role: 'Asesor Peddle' },
  { id: 'EMP-03', name: 'Maggie', weeklySalary: 75.0, role: 'Asesor Wheelzy' },
  { id: 'EMP-06', name: 'Darrel', weeklySalary: 75.0, role: 'Asesor Comercial' },
  { id: 'EMP-07', name: 'Samuel Rincon', weeklySalary: 75.0, role: 'Dispatcher RCAT' },
  { id: 'EMP-08', name: 'Jose Puche', weeklySalary: 75.0, role: 'Marketing' },
  { id: 'EMP-01', name: 'Juan', weeklySalary: 50.0, role: 'Asesor Saul Motors' },
];

export const DEFAULT_RECURRING_EXPENSES: RecurringExpense[] = [
  {
    id: 'REC-01',
    name: 'Alquiler de Local / Galpón y Oficina',
    category: 'Alquiler de Oficina / Patio',
    amount: 350.0,
    frequency: 'monthly',
    monthlyDay: 30,
    advanceIfWeekend: true,
    active: true,
    paymentMethod: 'Transferencia',
    notes: 'Pago mensual fijado para el día 30 (o último día de mes). Si cae en Viernes, Sábado o Domingo se anticipa automáticamente a la semana previa.',
  },
  {
    id: 'REC-02',
    name: 'Servicio de Internet Fibra & Comunicaciones',
    category: 'Servicios (Luz / Agua / Internet)',
    amount: 50.0,
    frequency: 'monthly',
    monthlyDay: 30,
    advanceIfWeekend: true,
    active: true,
    paymentMethod: 'Transferencia',
    notes: 'Pago mensual fijo de conectividad de oficina.',
  },
];

export const WeeklyRelationView: React.FC<WeeklyRelationViewProps> = ({
  orders = [],
  onBackToDashboard,
}) => {
  // =========================================================================
  // 1. 2FA SECURITY GATE STATE
  // =========================================================================
  const [is2FAUnlocked, setIs2FAUnlocked] = useState(false);

  const [digits, setDigits] = useState<string[]>(['', '', '', '', '', '']);
  const digitInputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const [otpRequested, setOtpRequested] = useState(false);
  const [otpCooldown, setOtpCooldown] = useState<number>(0);
  const [otpError, setOtpError] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<{
    text: string;
    code?: string;
  } | null>(null);
  const [isRequestingOtp, setIsRequestingOtp] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [safeAnimation, setSafeAnimation] = useState<'idle' | 'spin' | 'unlock' | 'error'>('idle');

  const showToast = (text: string, code?: string) => {
    setToastMessage({ text, code });
  };

  // Cooldown countdown (1 second interval)
  useEffect(() => {
    if (otpCooldown > 0) {
      const timer = setInterval(() => setOtpCooldown((prev) => prev - 1), 1000);
      return () => clearInterval(timer);
    }
  }, [otpCooldown]);

  // Request 2FA OTP Code via WhatsApp (Wasender directly to Super Admin)
  const handleRequestOTP = async () => {
    setIsRequestingOtp(true);
    setOtpError(null);
    setSafeAnimation('spin');
    setDigits(['', '', '', '', '', '']);

    try {
      const res = await apiFetch('/auth/2fa/request-otp', {
        method: 'POST',
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data.message || 'Error al solicitar el código 2FA');
      }

      setOtpCooldown(data.cooldownSeconds || 60);
      setOtpRequested(true);
      setTimeout(() => setSafeAnimation('idle'), 1000);

      // Focus first input box
      setTimeout(() => {
        digitInputRefs.current[0]?.focus();
      }, 120);

      showToast(
        data.message || 'Código de seguridad 2FA transmitido por WhatsApp al Super Admin (+58 412-***7933).'
      );
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Error al solicitar el código 2FA';
      setOtpError(errMsg);
      setSafeAnimation('error');
      setTimeout(() => setSafeAnimation('idle'), 1000);
    } finally {
      setIsRequestingOtp(false);
    }
  };

  // Auto-fill code helper (if toast provides one)
  const handleAutoFillCode = (code: string) => {
    const codeArr = code.split('').slice(0, 6);
    setDigits(codeArr);
    setOtpError(null);
    setToastMessage(null);
    executeVerification(code);
  };

  // Verify entered 2FA OTP code with backend (1 minute expiration & single-use check)
  const executeVerification = async (codeToVerify: string) => {
    if (!codeToVerify || codeToVerify.trim().length !== 6) {
      setOtpError('Ingresa los 6 dígitos del PIN de seguridad.');
      return;
    }

    setIsVerifying(true);
    setOtpError(null);

    try {
      const res = await apiFetch('/auth/2fa/verify-otp', {
        method: 'POST',
        body: JSON.stringify({ code: codeToVerify.trim() }),
      });
      const data = await res.json().catch(() => ({}));

      if (res.ok && data.verified) {
        setIs2FAUnlocked(true);
        setOtpError(null);
        setSafeAnimation('unlock');
        setToastMessage({
          text: '🔒 Sesión financiera 2FA desbloqueada exitosamente.',
        });
        setTimeout(() => setToastMessage(null), 3500);
      } else {
        setOtpError(data.message || 'Código incorrecto o expirado.');
        setSafeAnimation('error');
        setTimeout(() => setSafeAnimation('idle'), 900);
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Código de verificación incorrecto o expirado.';
      setOtpError(errMsg);
      setSafeAnimation('error');
      setTimeout(() => setSafeAnimation('idle'), 900);
    } finally {
      setIsVerifying(false);
    }
  };

  const handleDigitChange = (index: number, value: string) => {
    const cleanDigits = value.replace(/\D/g, '');
    if (cleanDigits.length > 1) {
      const newDigits = [...digits];
      const slice = cleanDigits.slice(0, 6);
      for (let i = 0; i < slice.length; i++) {
        newDigits[i] = slice[i];
      }
      setDigits(newDigits);
      setOtpError(null);
      const nextFocus = Math.min(slice.length, 5);
      digitInputRefs.current[nextFocus]?.focus();
      if (slice.length === 6) {
        executeVerification(slice);
      }
      return;
    }

    const singleDigit = cleanDigits.slice(-1);
    const newDigits = [...digits];
    newDigits[index] = singleDigit;
    setDigits(newDigits);
    setOtpError(null);

    if (singleDigit && index < 5) {
      digitInputRefs.current[index + 1]?.focus();
    }

    const fullCode = newDigits.join('');
    if (fullCode.length === 6 && newDigits.every((d) => d !== '')) {
      executeVerification(fullCode);
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace') {
      if (!digits[index] && index > 0) {
        const newDigits = [...digits];
        newDigits[index - 1] = '';
        setDigits(newDigits);
        digitInputRefs.current[index - 1]?.focus();
      }
    } else if (e.key === 'ArrowLeft' && index > 0) {
      digitInputRefs.current[index - 1]?.focus();
    } else if (e.key === 'ArrowRight' && index < 5) {
      digitInputRefs.current[index + 1]?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pastedText = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (!pastedText) return;

    const newDigits = ['', '', '', '', '', ''];
    for (let i = 0; i < pastedText.length; i++) {
      newDigits[i] = pastedText[i];
    }
    setDigits(newDigits);
    setOtpError(null);

    const nextIndex = Math.min(pastedText.length, 5);
    digitInputRefs.current[nextIndex]?.focus();

    if (pastedText.length === 6) {
      executeVerification(pastedText);
    }
  };

  // Lock session manually
  const handleLockSession = () => {
    setIs2FAUnlocked(false);
    setOtpRequested(false);
    setDigits(['', '', '', '', '', '']);
    setToastMessage({
      text: 'Sesión financiera bloqueada. Se requerirá autenticación 2FA para el próximo ingreso.',
    });
    setTimeout(() => setToastMessage(null), 3500);
  };

  // =========================================================================
  // 2. OFFICE EMPLOYEES & PAYROLL MANAGEMENT (PERSISTENT)
  // =========================================================================
  const [employees, setEmployees] = useState<OfficeEmployee[]>(() => {
    try {
      const saved = localStorage.getItem('radar_office_employees_v1');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch (e) {
      console.error('Error loading saved employees', e);
    }
    return DEFAULT_EMPLOYEES;
  });

  // Save employees changes to localStorage
  useEffect(() => {
    try {
      localStorage.setItem('radar_office_employees_v1', JSON.stringify(employees));
    } catch (e) {
      console.error('Error saving employees', e);
    }
  }, [employees]);

  // Modal State for Employee Management
  const [isEmployeesModalOpen, setIsEmployeesModalOpen] = useState(false);
  const [editingEmployeeId, setEditingEmployeeId] = useState<string | null>(null);
  const [employeeForm, setEmployeeForm] = useState<{
    name: string;
    weeklySalary: string;
    role: string;
  }>({
    name: '',
    weeklySalary: '',
    role: '',
  });

  const handleSaveEmployee = (e: React.FormEvent) => {
    e.preventDefault();
    const salary = parseFloat(employeeForm.weeklySalary);
    if (!employeeForm.name.trim() || isNaN(salary) || salary <= 0) {
      alert('Por favor ingrese el nombre del empleado y un salario semanal válido.');
      return;
    }

    if (editingEmployeeId) {
      // Update existing employee
      setEmployees(
        employees.map((emp) =>
          emp.id === editingEmployeeId
            ? {
                ...emp,
                name: employeeForm.name.trim(),
                weeklySalary: salary,
                role: employeeForm.role.trim() || undefined,
              }
            : emp
        )
      );
      showToast(`Empleado "${employeeForm.name}" actualizado.`);
      setEditingEmployeeId(null);
    } else {
      // Add new employee
      const newEmp: OfficeEmployee = {
        id: `EMP-${Date.now().toString().slice(-4)}`,
        name: employeeForm.name.trim(),
        weeklySalary: salary,
        role: employeeForm.role.trim() || 'Oficina / Personal',
      };
      setEmployees([...employees, newEmp]);
      showToast(`Empleado "${newEmp.name}" registrado en la nómina.`);
    }

    setEmployeeForm({ name: '', weeklySalary: '', role: '' });
  };

  const handleEditEmployee = (emp: OfficeEmployee) => {
    setEditingEmployeeId(emp.id);
    setEmployeeForm({
      name: emp.name,
      weeklySalary: String(emp.weeklySalary),
      role: emp.role || '',
    });
  };

  const handleDeleteEmployee = (id: string, name: string) => {
    if (confirm(`¿Eliminar al empleado "${name}" de la nómina semanal?`)) {
      setEmployees(employees.filter((emp) => emp.id !== id));
      if (editingEmployeeId === id) {
        setEditingEmployeeId(null);
        setEmployeeForm({ name: '', weeklySalary: '', role: '' });
      }
      showToast(`Empleado "${name}" eliminado de la nómina.`);
    }
  };

  // Sorted employees list (from highest weekly salary to lowest: de mayor a menor)
  const sortedEmployees = useMemo(() => {
    return [...employees].sort((a, b) => b.weeklySalary - a.weeklySalary);
  }, [employees]);

  // Total Weekly Payroll Sum
  const totalPayrollFixed = useMemo(() => {
    return employees.reduce((sum, e) => sum + e.weeklySalary, 0);
  }, [employees]);

  // =========================================================================
  // 2.2 RECURRING EXPENSES MANAGEMENT (ALQUILER, SERVICIOS, ETC.)
  // =========================================================================
  const [recurringExpenses, setRecurringExpenses] = useState<RecurringExpense[]>(() => {
    try {
      const saved = localStorage.getItem('radar_recurring_expenses_v1');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch (e) {
      console.error('Error loading saved recurring expenses', e);
    }
    return DEFAULT_RECURRING_EXPENSES;
  });

  useEffect(() => {
    try {
      localStorage.setItem('radar_recurring_expenses_v1', JSON.stringify(recurringExpenses));
    } catch (e) {
      console.error('Error saving recurring expenses', e);
    }
  }, [recurringExpenses]);

  const [isRecurringModalOpen, setIsRecurringModalOpen] = useState(false);
  const [editingRecurringId, setEditingRecurringId] = useState<string | null>(null);
  const [recurringForm, setRecurringForm] = useState<{
    name: string;
    category: RecurringExpense['category'];
    amount: string;
    frequency: RecurringExpense['frequency'];
    monthlyDay: string;
    advanceIfWeekend: boolean;
    active: boolean;
    notes: string;
    paymentMethod: RecurringExpense['paymentMethod'];
  }>({
    name: '',
    category: 'Alquiler de Oficina / Patio',
    amount: '',
    frequency: 'monthly',
    monthlyDay: '30',
    advanceIfWeekend: true,
    active: true,
    notes: '',
    paymentMethod: 'Transferencia',
  });

  const handleSaveRecurring = (e: React.FormEvent) => {
    e.preventDefault();
    const amount = parseFloat(recurringForm.amount);
    if (!recurringForm.name.trim() || isNaN(amount) || amount <= 0) {
      alert('Por favor ingrese el concepto y un monto válido en USD.');
      return;
    }

    const day = parseInt(recurringForm.monthlyDay, 10) || 30;

    if (editingRecurringId) {
      setRecurringExpenses(
        recurringExpenses.map((r) =>
          r.id === editingRecurringId
            ? {
                ...r,
                name: recurringForm.name.trim(),
                category: recurringForm.category,
                amount,
                frequency: recurringForm.frequency,
                monthlyDay: day,
                advanceIfWeekend: recurringForm.advanceIfWeekend,
                active: recurringForm.active,
                notes: recurringForm.notes.trim() || undefined,
                paymentMethod: recurringForm.paymentMethod,
              }
            : r
        )
      );
      showToast(`Gasto recurrente "${recurringForm.name}" actualizado.`);
      setEditingRecurringId(null);
    } else {
      const newRec: RecurringExpense = {
        id: `REC-${Date.now().toString().slice(-4)}`,
        name: recurringForm.name.trim(),
        category: recurringForm.category,
        amount,
        frequency: recurringForm.frequency,
        monthlyDay: day,
        advanceIfWeekend: recurringForm.advanceIfWeekend,
        active: recurringForm.active,
        notes: recurringForm.notes.trim() || undefined,
        paymentMethod: recurringForm.paymentMethod,
      };
      setRecurringExpenses([...recurringExpenses, newRec]);
      showToast(`Gasto recurrente "${newRec.name}" programado exitosamente.`);
    }

    setRecurringForm({
      name: '',
      category: 'Alquiler de Oficina / Patio',
      amount: '',
      frequency: 'monthly',
      monthlyDay: '30',
      advanceIfWeekend: true,
      active: true,
      notes: '',
      paymentMethod: 'Transferencia',
    });
  };

  const handleEditRecurring = (rec: RecurringExpense) => {
    setEditingRecurringId(rec.id);
    setRecurringForm({
      name: rec.name,
      category: rec.category,
      amount: String(rec.amount),
      frequency: rec.frequency,
      monthlyDay: String(rec.monthlyDay || 30),
      advanceIfWeekend: rec.advanceIfWeekend ?? true,
      active: rec.active,
      notes: rec.notes || '',
      paymentMethod: rec.paymentMethod,
    });
  };

  const handleDeleteRecurring = (id: string, name: string) => {
    if (confirm(`¿Eliminar la regla de gasto recurrente "${name}"?`)) {
      setRecurringExpenses(recurringExpenses.filter((r) => r.id !== id));
      if (editingRecurringId === id) {
        setEditingRecurringId(null);
      }
      showToast(`Gasto recurrente "${name}" eliminado.`);
    }
  };

  const handleToggleRecurringActive = (id: string) => {
    setRecurringExpenses(
      recurringExpenses.map((r) => (r.id === id ? { ...r, active: !r.active } : r))
    );
  };

  // =========================================================================
  // 3. TABS & FINANCIAL ENGINE STATE (CURRENT RUNNING WEEK)
  // =========================================================================
  const [activeTab, setActiveTab] = useState<'official' | 'sales' | 'deliveries' | 'general'>('official');

  // Compute Current Running Week Boundary (Monday to Sunday)
  const currentWeekRange = useMemo(() => {
    return getWeekRange(new Date());
  }, []);

  const weekRangeLabel = useMemo(() => {
    const { start, end } = currentWeekRange;
    const startStr = `${start.getDate().toString().padStart(2, '0')} ${start.toLocaleDateString('es-ES', { month: 'short' })}`;
    const endStr = `${end.getDate().toString().padStart(2, '0')} ${end.toLocaleDateString('es-ES', { month: 'short' })} ${end.getFullYear()}`;
    return `Semana Actual (${startStr} - ${endStr})`;
  }, [currentWeekRange]);

  // Recurring expenses due in the current running week (e.g. Alquiler de Local)
  const dueRecurringExpensesThisWeek = useMemo(() => {
    return recurringExpenses.filter((exp) => isRecurringExpenseDueInWeek(exp, currentWeekRange));
  }, [recurringExpenses, currentWeekRange]);

  const totalDueRecurringExpenses = useMemo(() => {
    return dueRecurringExpensesThisWeek.reduce((sum, exp) => sum + exp.amount, 0);
  }, [dueRecurringExpensesThisWeek]);

  // Operational expenses (excluding the base payroll employees which are dynamic)
  const [otherExpenses, setOtherExpenses] = useState<ExpenseItem[]>([]);

  // Modal State for New Operational Expense
  const [isNewExpenseModalOpen, setIsNewExpenseModalOpen] = useState(false);
  const [newExpenseForm, setNewExpenseForm] = useState<{
    description: string;
    category: ExpenseItem['category'];
    amount: string;
    date: string;
    paymentMethod: ExpenseItem['paymentMethod'];
    receiptNr: string;
  }>({
    description: '',
    category: 'Gastos Administrativos',
    amount: '',
    date: new Date().toISOString().split('T')[0],
    paymentMethod: 'Transferencia',
    receiptNr: '',
  });

  // =========================================================================
  // 4. WEEKLY ORDERS FILTERING (PAID SALES & DELIVERIES OF CURRENT WEEK)
  // =========================================================================

  // Paid Sales of the current running week:
  const weeklySalesOrders = useMemo(() => {
    return orders.filter((o) => {
      if (
        o.status === 'cotizacion' ||
        o.status === 'cancelado' ||
        o.status === 'archivado' ||
        o.status === 'solicitud_reembolso'
      ) {
        return false;
      }

      const isPaidSaleStatus =
        o.status === 'pagado' ||
        o.status === 'en_preparacion' ||
        o.status === 'listo_despacho' ||
        o.status === 'listo_retiro' ||
        o.status === 'en_camino' ||
        o.status === 'entregado';

      if (!isPaidSaleStatus) return false;

      const dateToCheck = o.createdAtIso || o.createdAt;
      return isDateInWeek(dateToCheck, currentWeekRange);
    });
  }, [orders, currentWeekRange]);

  // Delivered Parts of the current running week:
  const weeklyDeliveriesOrders = useMemo(() => {
    return orders.filter((o) => {
      if (o.status !== 'entregado') return false;
      const dateToCheck = o.deliveredAt || o.createdAtIso || o.createdAt;
      return isDateInWeek(dateToCheck, currentWeekRange);
    });
  }, [orders, currentWeekRange]);

  // Mathematical aggregates for Paid Sales
  const totalSalesVolume = useMemo(() => {
    return weeklySalesOrders.reduce(
      (sum, o) => sum + (o.financials?.total || o.financials?.partPrice || 0),
      0
    );
  }, [weeklySalesOrders]);

  const averageSalesTicket = useMemo(() => {
    if (weeklySalesOrders.length === 0) return 0;
    return totalSalesVolume / weeklySalesOrders.length;
  }, [totalSalesVolume, weeklySalesOrders.length]);

  // Mathematical aggregates for Delivered Parts
  const totalDeliveredCollected = useMemo(() => {
    return weeklyDeliveriesOrders.reduce(
      (sum, o) => sum + (o.financials?.total || o.financials?.partPrice || 0),
      0
    );
  }, [weeklyDeliveriesOrders]);

  const averageDeliveryValue = useMemo(() => {
    if (weeklyDeliveriesOrders.length === 0) return 0;
    return totalDeliveredCollected / weeklyDeliveriesOrders.length;
  }, [totalDeliveredCollected, weeklyDeliveriesOrders.length]);

  // Manager Commission = 2% of delivered parts total in current running week
  const managerCommission = useMemo(() => {
    return totalDeliveredCollected * 0.02;
  }, [totalDeliveredCollected]);

  // Total Other Operational Expenses
  const totalOtherExpenses = useMemo(() => {
    return otherExpenses.reduce((sum, exp) => sum + exp.amount, 0);
  }, [otherExpenses]);

  // Total Office Outflows = Total Payroll + Due Recurring Expenses + Other Expenses + 2% Manager Commission
  const totalExpensesWithCommission = useMemo(() => {
    return totalPayrollFixed + totalDueRecurringExpenses + totalOtherExpenses + managerCommission;
  }, [totalPayrollFixed, totalDueRecurringExpenses, totalOtherExpenses, managerCommission]);

  // Weekly Net Balance = Total Delivered Income - Total Outflows
  const netWeeklyBalance = useMemo(() => {
    return totalDeliveredCollected - totalExpensesWithCommission;
  }, [totalDeliveredCollected, totalExpensesWithCommission]);

  // Total a pagar in Tab 1 (Official Format) = Total Employee Salaries + Due Recurring Expenses + 2% Manager Commission
  const totalOfficialPayout = useMemo(() => {
    return totalPayrollFixed + totalDueRecurringExpenses + managerCommission;
  }, [totalPayrollFixed, totalDueRecurringExpenses, managerCommission]);

  // Combined Expenses List for Tab 4 (Relación General)
  // Sorted from highest salary/expense to lowest (de mayor a menor)
  const allGeneralConcepts = useMemo(() => {
    const todayStr = new Date().toISOString().split('T')[0];

    // 1. Employee salaries (Weekly recurring payroll, sorted highest to lowest)
    const employeeRows = sortedEmployees.map((emp) => ({
      id: `EMP-${emp.id}`,
      date: todayStr,
      category: 'Nómina / Personal' as const,
      description: emp.role ? `${emp.name} (${emp.role})` : emp.name,
      paymentMethod: 'Transferencia' as const,
      amount: emp.weeklySalary,
      isEmployee: true,
      isRecurring: false,
      rawEmployee: emp,
      rawRecurring: undefined,
      badge: 'Pago Recurrente Semanal',
    }));

    // 2. Due Recurring Expenses for this week (e.g. Alquiler de Local)
    const recurringRows = dueRecurringExpensesThisWeek.map((rec) => ({
      id: `REC-${rec.id}`,
      date: todayStr,
      category: rec.category,
      description: `${rec.name} (Gasto Recurrente Automático)`,
      paymentMethod: rec.paymentMethod,
      amount: rec.amount,
      isEmployee: false,
      isRecurring: true,
      rawEmployee: undefined,
      rawRecurring: rec,
      badge: 'Recurrente Mes',
    }));

    // 3. Other ad-hoc operational expenses
    const otherRows = [...otherExpenses]
      .sort((a, b) => b.amount - a.amount)
      .map((exp) => ({
        ...exp,
        isEmployee: false,
        isRecurring: false,
        rawEmployee: undefined,
        rawRecurring: undefined,
        badge: undefined,
      }));

    return [...employeeRows, ...recurringRows, ...otherRows];
  }, [sortedEmployees, dueRecurringExpensesThisWeek, otherExpenses]);

  // Handle Add Operational Expense Submit
  const handleAddExpenseSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsedAmount = parseFloat(newExpenseForm.amount);
    if (!newExpenseForm.description.trim() || isNaN(parsedAmount) || parsedAmount <= 0) {
      alert('Por favor complete la descripción y un monto válido en USD.');
      return;
    }

    const newExpense: ExpenseItem = {
      id: `EXP-${Math.floor(100 + Math.random() * 900)}`,
      description: newExpenseForm.description.trim(),
      category: newExpenseForm.category,
      amount: parsedAmount,
      date: newExpenseForm.date,
      paymentMethod: newExpenseForm.paymentMethod,
      receiptNr: newExpenseForm.receiptNr.trim() || undefined,
    };

    setOtherExpenses([newExpense, ...otherExpenses]);
    setIsNewExpenseModalOpen(false);
    setNewExpenseForm({
      description: '',
      category: 'Gastos Administrativos',
      amount: '',
      date: new Date().toISOString().split('T')[0],
      paymentMethod: 'Transferencia',
      receiptNr: '',
    });
    showToast(`Gasto "${newExpense.description}" registrado exitosamente.`);
  };

  const handleDeleteOtherExpense = (id: string) => {
    if (confirm('¿Está seguro de eliminar este registro de gasto operativo?')) {
      setOtherExpenses(otherExpenses.filter((e) => e.id !== id));
      showToast('Registro de gasto eliminado.');
    }
  };

  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);

  const handleExportPdf = async () => {
    setIsGeneratingPdf(true);
    try {
      const dateStr = new Date().toISOString().slice(0, 10);
      if (activeTab === 'sales') {
        const bytes = await generateWeeklySalesPdf({
          orders: weeklySalesOrders,
          totalSales: totalSalesVolume,
          weekLabel: `Semana Actual · ${weeklySalesOrders.length} ventas`,
        });
        downloadPdfBytes(bytes, `ventas_semana_${dateStr}.pdf`);
        showToast('📄 PDF de Ventas descargado con éxito.');
      } else if (activeTab === 'general') {
        const bytes = await generateGeneralRelationPdf({
          income: totalDeliveredCollected,
          operationalCosts: totalExpensesWithCommission,
          netBalance: netWeeklyBalance,
          commission: managerCommission,
          expenses: allGeneralConcepts.map((e) => ({
            date: e.date,
            category: e.category,
            description: e.description,
            method: e.paymentMethod,
            amount: e.amount,
          })),
          weekLabel: 'Relación General de Entregas y Gastos Operativos',
        });
        downloadPdfBytes(bytes, `relacion_general_semanal_${dateStr}.pdf`);
        showToast('📄 PDF de Relación General descargado con éxito.');
      } else {
        // 'official' or 'deliveries'
        const bytes = await generateOfficialDeliveriesPdf({
          orders: weeklyDeliveriesOrders,
          commissionPercentage: 2,
          commissionAmount: managerCommission,
          employees,
          recurringExpenses: dueRecurringExpensesThisWeek,
          totalPayout: totalOfficialPayout,
          subtotalDeliveries: totalDeliveredCollected,
          weekLabel: 'Relación de Entregas Semanal y Liquidación',
        });
        downloadPdfBytes(bytes, `formato_oficial_entregas_${dateStr}.pdf`);
        showToast('📄 Formato Oficial PDF descargado con éxito.');
      }
    } catch (err) {
      console.error('Error al generar PDF:', err);
      showToast('❌ Error al generar el archivo PDF.');
    } finally {
      setIsGeneratingPdf(false);
    }
  };

  const handlePrint = handleExportPdf;

  // =========================================================================
  // 5. RENDER 2FA LOCK SCREEN IF LOCKED (CYBERPUNK NEON GLASSMORPHISM)
  // =========================================================================
  if (!is2FAUnlocked) {
    const isCodeComplete = digits.every((d) => d !== '');

    return (
      <div className="flex items-center justify-center min-h-[75vh] p-3 sm:p-6 animate-fade-in relative overflow-hidden">
        {/* Floating WhatsApp Simulation Toast */}
        {toastMessage && (
          <div className="fixed top-6 sm:top-8 right-6 z-50 max-w-md w-full sm:w-auto bg-[#041a14]/95 text-white font-medium text-xs py-3.5 px-5 rounded-2xl shadow-[0_10px_40px_rgba(0,0,0,0.8),0_0_30px_rgba(16,185,129,0.35)] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 animate-bounce border-2 border-emerald-500/60 backdrop-blur-2xl">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-xl bg-emerald-500/20 border border-emerald-400/50 flex items-center justify-center text-emerald-400 shrink-0 shadow-[0_0_12px_rgba(16,185,129,0.4)]">
                <span className="material-symbols-outlined text-[20px]">mark_chat_read</span>
              </div>
              <div className="text-left">
                <div className="text-[10px] font-mono uppercase tracking-wider text-emerald-400 font-bold">
                  📲 Notificación Wasender 2FA
                </div>
                <div className="text-xs text-slate-200 mt-0.5">
                  {toastMessage.text}{' '}
                  {toastMessage.code && (
                    <span className="font-mono font-black text-emerald-300 text-sm tracking-widest bg-emerald-950/80 px-2 py-0.5 rounded border border-emerald-500/40 ml-1">
                      {toastMessage.code}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {toastMessage.code && (
              <button
                type="button"
                onClick={() => handleAutoFillCode(toastMessage.code!)}
                className="w-full sm:w-auto mt-2 sm:mt-0 px-3 py-1.5 rounded-xl bg-gradient-to-r from-emerald-400 to-cyan-400 hover:from-emerald-300 hover:to-cyan-300 text-slate-950 font-black text-[11px] tracking-wide shrink-0 transition-transform active:scale-95 shadow-[0_0_15px_rgba(16,185,129,0.5)] cursor-pointer"
              >
                ⚡ Insertar PIN
              </button>
            )}
          </div>
        )}

        {/* Ambient Neon Backlight Orbs */}
        <div className="absolute top-1/4 left-1/4 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-cyan-500/12 rounded-full blur-[60px] pointer-events-none" />
        <div className="absolute bottom-1/4 right-1/4 translate-x-1/2 translate-y-1/2 w-96 h-96 bg-emerald-500/12 rounded-full blur-[60px] pointer-events-none" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[32rem] h-[32rem] bg-blue-600/10 rounded-full blur-[60px] pointer-events-none" />

        {/* Main Cyber Glassmorphic 2FA Card */}
        <div className="relative max-w-lg w-full rounded-[24px] sm:rounded-[30px] bg-[#070c18]/92 backdrop-blur-2xl border border-cyan-500/35 p-5 sm:p-8 max-h-[min(94vh,680px)] overflow-y-auto custom-scrollbar shadow-[0_25px_70px_rgba(0,0,0,0.85),0_0_60px_rgba(6,182,212,0.18),inset_0_1px_2px_rgba(255,255,255,0.15)] flex flex-col items-center text-center">
          <div className="absolute top-0 inset-x-0 h-[2.5px] bg-gradient-to-r from-transparent via-cyan-400 to-emerald-400 shadow-[0_0_18px_#22d3ee]" />

          <div className="relative mb-5 flex items-center justify-center">
            <div className="absolute -inset-4 rounded-full border border-dashed border-cyan-500/30 animate-cyber-orbit pointer-events-none" />
            <div className="absolute -inset-7 rounded-full border border-dotted border-emerald-400/25 animate-cyber-orbit-reverse pointer-events-none" />
            <div className="absolute inset-0 rounded-3xl bg-cyan-500/20 blur-xl animate-pulse" />

            <div
              className={`relative w-22 h-22 rounded-3xl bg-gradient-to-br from-[#0c1a30] via-[#060c18] to-[#040812] border-2 border-cyan-400/60 flex items-center justify-center text-cyan-400 shadow-[0_0_35px_rgba(6,182,212,0.4),inset_0_0_20px_rgba(6,182,212,0.25)] overflow-hidden transition-all duration-300 ${
                safeAnimation === 'spin' ? 'rotate-180 scale-105 border-emerald-400 text-emerald-400' : ''
              } ${safeAnimation === 'unlock' ? 'border-emerald-400 text-emerald-400 scale-110 shadow-[0_0_40px_rgba(16,185,129,0.6)]' : ''} ${
                safeAnimation === 'error' ? 'animate-shake border-red-500 text-red-400 shadow-[0_0_35px_rgba(239,68,68,0.5)]' : ''
              }`}
            >
              <div className="absolute inset-x-0 h-[2px] bg-cyan-400 shadow-[0_0_10px_#22d3ee] animate-cyber-scan pointer-events-none" />
              <span className="material-symbols-outlined text-[42px] drop-shadow-[0_0_12px_rgba(34,211,238,0.8)]">
                {safeAnimation === 'unlock' ? 'lock_open' : 'security'}
              </span>
            </div>
          </div>

          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-[#040b17]/90 border border-cyan-400/40 text-[10.5px] font-mono font-bold tracking-[0.22em] text-cyan-300 uppercase mb-3 shadow-[0_0_15px_rgba(6,182,212,0.25)]">
            <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_#34d399] animate-ping" />
            <span>AUTENTICACIÓN EN DOS PASOS (2FA)</span>
          </div>

          <h2 className="text-2xl sm:text-3xl font-black tracking-tight text-white drop-shadow-[0_2px_10px_rgba(0,0,0,0.5)]">
            Relación Semanal & Finanzas
          </h2>

          <p className="text-xs text-[#94a3b8] mt-1.5 leading-relaxed max-w-sm">
            Bóveda financiera protegida de Radar 3.0. Para desbloquear el acceso, ingresa el PIN de 6 dígitos transmitido por WhatsApp al Super Admin (expira en 1 minuto).
          </p>

          {/* WhatsApp Transmission Pod */}
          <div className="w-full bg-[#050b16]/95 border border-cyan-500/30 hover:border-cyan-400/50 rounded-2xl p-4 mt-5 mb-5 flex items-center justify-between gap-3 text-xs shadow-[inset_0_0_20px_rgba(0,0,0,0.7)] transition-all">
            <div className="flex items-center gap-3 text-left">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/15 border border-emerald-400/40 flex items-center justify-center text-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.3)] shrink-0">
                <span className="material-symbols-outlined text-[22px]">chat</span>
              </div>
              <div>
                <span className="text-[10px] uppercase font-mono font-bold text-emerald-400/90 block tracking-wider">
                  CANAL SEGURO WHATSAPP
                </span>
                <strong className="text-white font-mono text-sm tracking-wider drop-shadow-[0_0_8px_rgba(255,255,255,0.4)]">
                  +58 412-***7933
                </strong>
              </div>
            </div>

            <button
              type="button"
              onClick={handleRequestOTP}
              disabled={otpCooldown > 0 || isRequestingOtp}
              className={`py-2 px-3.5 rounded-xl text-xs font-black tracking-wide transition-all cursor-pointer flex items-center gap-1.5 shrink-0 ${
                otpCooldown > 0 || isRequestingOtp
                  ? 'bg-[#0f172a] text-[#64748b] cursor-not-allowed border border-[#1e293b]'
                  : 'bg-gradient-to-r from-emerald-400 to-cyan-500 hover:from-emerald-300 hover:to-cyan-400 text-slate-950 shadow-[0_0_20px_rgba(16,185,129,0.4)] hover:shadow-[0_0_25px_rgba(34,211,238,0.6)]'
              }`}
            >
              <span className="material-symbols-outlined text-[16px]">
                {isRequestingOtp ? 'sync' : otpCooldown > 0 ? 'hourglass_top' : 'send'}
              </span>
              <span>
                {isRequestingOtp
                  ? 'Enviando...'
                  : otpCooldown > 0
                  ? `${otpCooldown}s`
                  : 'Solicitar Código'}
              </span>
            </button>
          </div>

          {/* 6-Digit Segmented PIN Grid */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              executeVerification(digits.join(''));
            }}
            className="w-full"
          >
            <div className="mb-2 text-left flex items-center justify-between">
              <label className="text-[11px] font-mono uppercase tracking-wider text-cyan-300/90 font-bold">
                PIN de Seguridad (6 dígitos)
              </label>
              {(otpRequested || otpCooldown > 0) && (
                <span className="text-[10px] text-emerald-400 font-mono flex items-center gap-1 font-bold">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  PIN transmitido (Válido 1 min)
                </span>
              )}
            </div>

            <div className="flex items-center justify-between gap-1.5 sm:gap-2.5 my-3">
              {digits.map((digit, idx) => (
                <React.Fragment key={idx}>
                  {idx === 3 && (
                    <div className="text-cyan-400/60 font-mono font-bold text-xl select-none px-0.5 drop-shadow-[0_0_8px_rgba(34,211,238,0.5)]">
                      •
                    </div>
                  )}
                  <input
                    ref={(el) => (digitInputRefs.current[idx] = el)}
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={1}
                    value={digit}
                    onChange={(e) => handleDigitChange(idx, e.target.value)}
                    onKeyDown={(e) => handleKeyDown(idx, e)}
                    onPaste={handlePaste}
                    className={`w-11 h-14 sm:w-13 sm:h-16 rounded-2xl text-center font-mono text-2xl font-black transition-all outline-none ${
                      digit
                        ? 'bg-[#0a1830] border-2 border-cyan-400 text-cyan-300 shadow-[0_0_20px_rgba(34,211,238,0.45),inset_0_0_12px_rgba(34,211,238,0.2)]'
                        : 'bg-[#040814] border border-cyan-500/25 text-white focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/30 focus:shadow-[0_0_15px_rgba(34,211,238,0.3)]'
                    } ${
                      otpError
                        ? 'border-red-500 text-red-400 shadow-[0_0_20px_rgba(239,68,68,0.35)] bg-red-950/20'
                        : ''
                    }`}
                  />
                </React.Fragment>
              ))}
            </div>

            {otpError && (
              <div className="my-3 p-3 bg-red-500/15 border border-red-500/40 rounded-2xl text-xs text-red-200 flex items-center gap-2.5 text-left animate-shake shadow-[0_0_20px_rgba(239,68,68,0.2)]">
                <span className="material-symbols-outlined text-[19px] text-red-400 shrink-0">error</span>
                <span className="font-mono">{otpError}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={!isCodeComplete || isVerifying}
              className="w-full mt-4 bg-gradient-to-r from-cyan-400 via-blue-500 to-emerald-400 hover:from-cyan-300 hover:to-emerald-300 text-slate-950 font-black tracking-wider uppercase text-xs py-3.5 px-5 rounded-2xl transition-all cursor-pointer shadow-[0_0_30px_rgba(6,182,212,0.45)] hover:shadow-[0_0_40px_rgba(16,185,129,0.6)] disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 active:scale-[0.98]"
            >
              {isVerifying ? (
                <>
                  <span className="w-4 h-4 border-2 border-slate-950 border-t-transparent rounded-full animate-spin" />
                  <span>AUTENTICANDO ACCESO...</span>
                </>
              ) : (
                <>
                  <span className="material-symbols-outlined text-[20px]">verified_user</span>
                  <span>VERIFICAR Y DESBLOQUEAR</span>
                </>
              )}
            </button>

            {onBackToDashboard && (
              <button
                type="button"
                onClick={onBackToDashboard}
                className="mt-3 text-[11px] font-medium text-[#94a3b8] hover:text-cyan-300 transition-colors cursor-pointer inline-flex items-center gap-1.5"
              >
                <span className="material-symbols-outlined text-[14px]">arrow_back</span>
                <span>Volver al Dashboard Principal</span>
              </button>
            )}
          </form>

          <div className="mt-6 pt-4 border-t border-cyan-500/15 w-full flex items-center justify-center gap-2 text-[10px] font-mono text-cyan-400/60 uppercase tracking-widest">
            <span className="material-symbols-outlined text-[14px] text-emerald-400">lock</span>
            <span>SHA-256 E2EE • PROTOCOLO RADAR V3 2FA</span>
          </div>
        </div>
      </div>
    );
  }

  // =========================================================================
  // 6. RENDER FULL FINANCIAL DASHBOARD (UNLOCKED)
  // =========================================================================
  return (
    <div className="radar-view space-y-6 pb-16">
      {/* Toast Feedback */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 bg-[#10b981] text-[#042f2e] font-bold text-xs py-3 px-5 rounded-xl shadow-[0_10px_25px_rgba(16,185,129,0.4)] flex items-center gap-2.5 animate-bounce print:hidden">
          <span className="material-symbols-outlined text-[20px]">task_alt</span>
          <span>{toastMessage.text}</span>
        </div>
      )}

      {/* Header Container */}
      <div className="bg-[#0f172a]/95 border border-[#1e293b] rounded-2xl p-5 md:p-6 backdrop-blur-md flex flex-col md:flex-row md:items-center justify-between gap-5 shadow-xl print:hidden">
        <div>
          {/* Breadcrumb Navigation */}
          {onBackToDashboard && (
            <button
              onClick={onBackToDashboard}
              className="inline-flex items-center gap-1.5 text-xs text-[#94a3b8] hover:text-[#388bfd] transition-colors mb-2 cursor-pointer"
            >
              <span className="material-symbols-outlined text-[15px]">arrow_back</span>
              <span>Dashboard</span>
              <span className="text-[#475569]">/</span>
              <span className="text-[#388bfd] font-semibold">Relación Semanal</span>
            </button>
          )}

          <div className="flex items-center gap-3.5">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-[#0284c7]/20 to-[#388bfd]/30 border border-[#388bfd]/40 flex items-center justify-center text-[#388bfd] shadow-[0_0_20px_rgba(56,139,253,0.2)] shrink-0">
              <span className="material-symbols-outlined text-[28px]">domain</span>
            </div>
            <div>
              <h1 className="text-xl md:text-2xl font-black text-white tracking-tight flex items-center gap-2">
                <span>Relación Semanal · Costos Operativos de Oficina</span>
              </h1>
              <p className="text-xs text-[#94a3b8] mt-0.5 max-w-2xl">
                Panel administrativo exclusivo: Control de ventas, entregas semanales, comisiones del 2% y nómina operativa.
              </p>
            </div>
          </div>
        </div>

        {/* Global Action Controls */}
        <div className="flex items-center gap-2.5 flex-wrap self-start md:self-auto">
          {/* Week Mode Indicator */}
          <div className="bg-[#0b1329] border border-[#1e293b] rounded-xl px-3 py-1.5 text-xs text-[#cbd5e1] font-medium flex items-center gap-2">
            <span className="material-symbols-outlined text-[16px] text-[#388bfd]">calendar_month</span>
            <span className="font-mono text-[11px] font-bold">{weekRangeLabel}</span>
          </div>

          {/* Manage Employees / Payroll Button */}
          <button
            onClick={() => setIsEmployeesModalOpen(true)}
            className="bg-[#0b1329] hover:bg-[#1e293b] text-[#38bdf8] font-bold text-xs py-2 px-3.5 rounded-xl border border-[#0284c7]/40 transition-all cursor-pointer shadow-sm flex items-center gap-1.5"
          >
            <span className="material-symbols-outlined text-[18px]">group</span>
            <span>Nómina Empleados ({employees.length})</span>
          </button>

          {/* Manage Recurring Expenses Button */}
          <button
            onClick={() => setIsRecurringModalOpen(true)}
            className="bg-[#0b1329] hover:bg-[#1e293b] text-[#fbbf24] font-bold text-xs py-2 px-3.5 rounded-xl border border-[#f59e0b]/40 transition-all cursor-pointer shadow-sm flex items-center gap-1.5"
          >
            <span className="material-symbols-outlined text-[18px]">event_repeat</span>
            <span>Gastos Recurrentes ({recurringExpenses.filter((r) => r.active).length})</span>
          </button>

          {/* Print PDF Button */}
          <button
            onClick={handleExportPdf}
            disabled={isGeneratingPdf}
            className="bg-[#1e293b] hover:bg-[#334155] text-white font-bold text-xs py-2 px-3.5 rounded-xl border border-[#334155] transition-all cursor-pointer shadow-sm flex items-center gap-1.5 disabled:opacity-50"
          >
            <span className="material-symbols-outlined text-[18px]">
              {isGeneratingPdf ? 'hourglass_top' : 'picture_as_pdf'}
            </span>
            <span>{isGeneratingPdf ? 'Generando...' : 'Descargar PDF'}</span>
          </button>

          {/* New Expense Button */}
          {activeTab === 'general' && (
            <button
              onClick={() => setIsNewExpenseModalOpen(true)}
              className="bg-gradient-to-r from-[#2563eb] to-[#1d4ed8] hover:from-[#1d4ed8] hover:to-[#1e40af] text-white font-bold text-xs py-2 px-3.5 rounded-xl transition-all cursor-pointer shadow-[0_0_15px_rgba(37,99,235,0.35)] flex items-center gap-1.5"
            >
              <span className="material-symbols-outlined text-[18px]">add</span>
              <span>Nuevo Gasto</span>
            </button>
          )}

          {/* Lock Session Button */}
          <button
            onClick={handleLockSession}
            title="Bloquear Bóveda 2FA"
            className="p-2 rounded-xl bg-[#ef4444]/10 hover:bg-[#ef4444]/20 text-[#f87171] border border-[#ef4444]/30 transition-colors cursor-pointer flex items-center justify-center"
          >
            <span className="material-symbols-outlined text-[18px]">lock</span>
          </button>
        </div>
      </div>

      {/* 4 Navigation Sub-Tabs Bar */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1 custom-scrollbar print:hidden">
        {/* Tab 1: Formato Oficial Entregas */}
        <button
          onClick={() => setActiveTab('official')}
          className={`py-2.5 px-4 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-2 shrink-0 ${
            activeTab === 'official'
              ? 'bg-[#0284c7]/20 border-2 border-[#0284c7] text-[#38bdf8] shadow-[0_0_15px_rgba(2,132,199,0.25)]'
              : 'bg-[#0f172a]/80 border border-[#1e293b] text-[#94a3b8] hover:text-white hover:bg-[#1e293b]/60'
          }`}
        >
          <span className="material-symbols-outlined text-[18px]">print</span>
          <span>Formato Oficial Entregas</span>
          <span className={`text-[11px] font-mono px-2 py-0.5 rounded-full ${
            activeTab === 'official' ? 'bg-[#0284c7]/30 text-white' : 'bg-[#1e293b] text-[#94a3b8]'
          }`}>
            {weeklyDeliveriesOrders.length}
          </span>
        </button>

        {/* Tab 2: Ventas de la Semana */}
        <button
          onClick={() => setActiveTab('sales')}
          className={`py-2.5 px-4 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-2 shrink-0 ${
            activeTab === 'sales'
              ? 'bg-[#10b981]/20 border-2 border-[#10b981] text-[#34d399] shadow-[0_0_15px_rgba(16,185,129,0.25)]'
              : 'bg-[#0f172a]/80 border border-[#1e293b] text-[#94a3b8] hover:text-white hover:bg-[#1e293b]/60'
          }`}
        >
          <span className="material-symbols-outlined text-[18px]">inbox</span>
          <span>Ventas de la Semana</span>
          <span className={`text-[11px] font-mono px-2 py-0.5 rounded-full ${
            activeTab === 'sales' ? 'bg-[#10b981]/30 text-white' : 'bg-[#1e293b] text-[#94a3b8]'
          }`}>
            {weeklySalesOrders.length}
          </span>
        </button>

        {/* Tab 3: Entregas de la Semana */}
        <button
          onClick={() => setActiveTab('deliveries')}
          className={`py-2.5 px-4 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-2 shrink-0 ${
            activeTab === 'deliveries'
              ? 'bg-[#3b82f6]/20 border-2 border-[#3b82f6] text-[#60a5fa] shadow-[0_0_15px_rgba(59,130,246,0.25)]'
              : 'bg-[#0f172a]/80 border border-[#1e293b] text-[#94a3b8] hover:text-white hover:bg-[#1e293b]/60'
          }`}
        >
          <span className="material-symbols-outlined text-[18px]">inventory_2</span>
          <span>Entregas de la Semana</span>
          <span className={`text-[11px] font-mono px-2 py-0.5 rounded-full ${
            activeTab === 'deliveries' ? 'bg-[#3b82f6]/30 text-white' : 'bg-[#1e293b] text-[#94a3b8]'
          }`}>
            {weeklyDeliveriesOrders.length}
          </span>
        </button>

        {/* Tab 4: Relación General de Entregas y Gastos */}
        <button
          onClick={() => setActiveTab('general')}
          className={`py-2.5 px-4 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-2 shrink-0 ${
            activeTab === 'general'
              ? 'bg-[#f59e0b]/20 border-2 border-[#f59e0b] text-[#fbbf24] shadow-[0_0_15px_rgba(245,158,11,0.25)]'
              : 'bg-[#0f172a]/80 border border-[#1e293b] text-[#94a3b8] hover:text-white hover:bg-[#1e293b]/60'
          }`}
        >
          <span className="material-symbols-outlined text-[18px]">description</span>
          <span>Relación General de Entregas y Gastos</span>
        </button>
      </div>

      {/* ===================================================================== */}
      {/* SUB-TAB 1: FORMATO OFICIAL ENTREGAS (IMAGE 1)                         */}
      {/* ===================================================================== */}
      {activeTab === 'official' && (
        <div className="space-y-4">
          {/* Recurring Expense Notice Alert (if active this week) */}
          {dueRecurringExpensesThisWeek.length > 0 && (
            <div className="bg-[#0284c7]/15 border border-[#0284c7]/40 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-[#38bdf8] shadow-lg print:border-black print:text-black">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-[#0284c7]/20 border border-[#0284c7]/40 flex items-center justify-center text-[#38bdf8] shrink-0">
                  <span className="material-symbols-outlined text-[20px]">event_repeat</span>
                </div>
                <div>
                  <span className="font-mono text-[10px] uppercase font-bold text-[#38bdf8] block tracking-wider">
                    🔄 GASTOS RECURRENTES IMPUTADOS ESTA SEMANA
                  </span>
                  <div className="text-white text-xs mt-0.5">
                    Esta semana incluye el cobro automático de:{' '}
                    <strong>{dueRecurringExpensesThisWeek.map((r) => `${r.name} ($${r.amount.toFixed(2)})`).join(', ')}</strong>.
                  </div>
                </div>
              </div>
              <span className="font-mono text-xs font-bold bg-[#0284c7]/30 px-3 py-1 rounded-xl text-white border border-[#0284c7]/40 self-start sm:self-auto shrink-0">
                +${totalDueRecurringExpenses.toFixed(2)} USD
              </span>
            </div>
          )}

          {/* Subheader & Actions */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-[#94a3b8] print:hidden">
            <p>Formato de hoja de liquidación semanal para nómina, gastos fijos y pagos administrativos.</p>
            <div className="flex items-center gap-2.5 flex-wrap">
              <button
                onClick={() => setIsEmployeesModalOpen(true)}
                className="bg-[#0b1329] hover:bg-[#1e293b] text-[#38bdf8] font-bold text-xs py-2 px-3 rounded-xl border border-[#0284c7]/40 transition-all cursor-pointer flex items-center gap-1.5"
              >
                <span className="material-symbols-outlined text-[16px]">manage_accounts</span>
                <span>Configurar Empleados</span>
              </button>
              <button
                onClick={() => setIsRecurringModalOpen(true)}
                className="bg-[#0b1329] hover:bg-[#1e293b] text-[#fbbf24] font-bold text-xs py-2 px-3 rounded-xl border border-[#f59e0b]/40 transition-all cursor-pointer flex items-center gap-1.5"
              >
                <span className="material-symbols-outlined text-[16px]">event_repeat</span>
                <span>Gastos Recurrentes</span>
              </button>
              <button
                onClick={handleExportPdf}
                disabled={isGeneratingPdf}
                className="bg-gradient-to-r from-[#2563eb] to-[#1d4ed8] hover:from-[#1d4ed8] hover:to-[#1e40af] text-white font-bold text-xs py-2 px-3.5 rounded-xl transition-all cursor-pointer shadow-[0_0_15px_rgba(37,99,235,0.3)] flex items-center gap-1.5 disabled:opacity-50"
              >
                <span className="material-symbols-outlined text-[17px]">
                  {isGeneratingPdf ? 'hourglass_top' : 'picture_as_pdf'}
                </span>
                <span>{isGeneratingPdf ? 'Generando PDF...' : 'Descargar Formato (PDF)'}</span>
              </button>
            </div>
          </div>

          {/* Official Document Card (Pure Print & PDF Match) */}
          <div className="official-print-card bg-[#0f172a] border border-[#1e293b] rounded-2xl p-6 sm:p-8 shadow-xl print:bg-white print:border-none print:shadow-none print:p-0">
            {/* Centered Document Title */}
            <h2 className="official-print-title text-xl sm:text-2xl font-black text-white text-center mb-6 tracking-tight print:text-black">
              Entregas de esta semana
            </h2>

            {/* Table Box */}
            <div className="official-print-table-box table-responsive-wrapper rounded-2xl overflow-hidden border border-[#1e293b] print:border-[#cbd5e1] print:rounded-2xl">
              <table className="official-print-table w-full text-left text-xs min-w-[700px] print:min-w-full">
                <thead className="bg-[#0284c7] text-white font-bold uppercase text-[11px] tracking-wider print:bg-white print:text-[#0f172a] print:border-b-2 print:border-[#0f172a]">
                  <tr>
                    <th className="py-3 px-4 print:py-2.5 print:px-3">CLIENTE</th>
                    <th className="py-3 px-4 print:py-2.5 print:px-3">AÑO</th>
                    <th className="py-3 px-4 print:py-2.5 print:px-3">MARCA</th>
                    <th className="py-3 px-4 print:py-2.5 print:px-3">MODELO</th>
                    <th className="py-3 px-4 print:py-2.5 print:px-3">TIPO PIEZA</th>
                    <th className="py-3 px-4 print:py-2.5 print:px-3">SPECS</th>
                    <th className="py-3 px-4 text-right print:py-2.5 print:px-3">PRECIO</th>
                  </tr>
                </thead>
                <tbody className="bg-[#0b1329] divide-y divide-[#1e293b] text-[#cbd5e1] print:bg-white print:divide-[#e2e8f0] print:text-black">
                  {weeklyDeliveriesOrders.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-xs text-[#94a3b8] italic print:text-gray-500">
                        No se registran entregas en esta semana.
                      </td>
                    </tr>
                  ) : (
                    weeklyDeliveriesOrders.map((order) => {
                      const price = order.financials?.total || order.financials?.partPrice || 0;
                      return (
                        <tr key={order.id} className="hover:bg-[#1e293b]/50 transition-colors print:hover:bg-transparent">
                          <td className="py-3.5 px-4 font-bold text-white print:text-black print:py-2.5 print:px-3">
                            {order.customer.name}
                          </td>
                          <td className="py-3.5 px-4 font-mono print:text-black print:py-2.5 print:px-3">
                            {order.vehicle.year}
                          </td>
                          <td className="py-3.5 px-4 print:text-black print:py-2.5 print:px-3">
                            {order.vehicle.make}
                          </td>
                          <td className="py-3.5 px-4 print:text-black print:py-2.5 print:px-3">
                            {order.vehicle.model}
                          </td>
                          <td className="py-3.5 px-4 font-medium text-white print:text-black print:py-2.5 print:px-3">
                            {order.mainPart}
                          </td>
                          <td className="py-3.5 px-4 text-[#94a3b8] text-[11px] max-w-xs truncate print:text-black print:py-2.5 print:px-3">
                            {order.productSpecs || `${order.vehicle.trim || ''} ${order.vehicle.transmission || ''}`.trim() || '—'}
                          </td>
                          <td className="py-3.5 px-4 text-right font-mono font-bold text-white print:text-black print:py-2.5 print:px-3">
                            $ {price.toFixed(2)}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>

              {/* Subtotal Row */}
              <div className="official-print-subtotal-row bg-[#0f172a] border-t-2 border-[#1e293b] py-3.5 px-6 flex items-center justify-end gap-3 text-sm print:bg-white print:border-t-2 print:border-[#0f172a] print:py-3 print:px-4">
                <span className="font-bold text-[#94a3b8] print:text-black">Subtotal:</span>
                <span className="font-mono font-black text-white text-base print:text-black print:text-base">
                  $ {totalDeliveredCollected.toFixed(2)}
                </span>
              </div>
            </div>

            {/* Bottom-Right Payroll, Commission, and Recurring Expenses Summary Box */}
            <div className="official-print-summary-box flex justify-end mt-8 print:mt-6">
              <div className="w-full max-w-xs space-y-1.5 text-xs text-[#cbd5e1] print:text-black print:max-w-[280px]">
                {/* 2% Manager Commission */}
                <div className="flex justify-between items-center py-0.5">
                  <span className="font-bold text-white print:text-black">Comision (2%)</span>
                  <span className="font-mono font-bold text-white print:text-black">
                    $ {managerCommission.toFixed(2)}
                  </span>
                </div>

                {/* Personnel salaries (Dynamic from employees list - Sorted highest to lowest) */}
                {sortedEmployees.map((person) => (
                  <div key={person.id} className="flex justify-between items-center py-0.5">
                    <span className="truncate pr-2 text-[#cbd5e1] print:text-black font-medium">
                      {person.name}
                    </span>
                    <span className="font-mono font-medium text-[#cbd5e1] print:text-black">
                      $ {person.weeklySalary.toFixed(2)}
                    </span>
                  </div>
                ))}

                {/* Due Recurring Expenses this week (e.g. Alquiler de Local) */}
                {dueRecurringExpensesThisWeek.map((rec) => (
                  <div key={rec.id} className="flex justify-between items-center py-0.5 text-[#38bdf8] print:text-black">
                    <span className="truncate pr-2 font-medium flex items-center gap-1 print:text-black">
                      <span className="material-symbols-outlined text-[14px] print:hidden">event_repeat</span>
                      <span>{rec.name}</span>
                    </span>
                    <span className="font-mono font-bold text-[#38bdf8] print:text-black">
                      $ {rec.amount.toFixed(2)}
                    </span>
                  </div>
                ))}

                {/* Heavy Divider Line */}
                <div className="official-print-divider border-t-2 border-[#334155] print:border-[#0f172a] my-2 pt-2" />

                {/* Total Payout */}
                <div className="official-print-total-row flex justify-between items-center text-sm sm:text-base font-black text-white print:text-black pt-1">
                  <span className="uppercase tracking-wider font-black">TOTAL A PAGAR</span>
                  <span className="font-mono text-lg print:text-xl font-black text-white print:text-black">
                    $ {totalOfficialPayout.toFixed(2)}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* SUB-TAB 2: VENTAS DE LA SEMANA (IMAGE 2)                              */}
      {/* ===================================================================== */}
      {activeTab === 'sales' && (
        <div className="space-y-6">
          {/* 3 Executive KPI Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Total Ventas Pagadas (Green) */}
            <div className="bg-[#0f172a] border border-[#10b981]/30 rounded-2xl p-5 flex items-center justify-between shadow-lg relative overflow-hidden">
              <div className="space-y-1">
                <span className="text-[10px] font-bold text-[#94a3b8] uppercase tracking-wider block">
                  TOTAL VENTAS PAGADAS
                </span>
                <div className="text-3xl font-black font-mono text-[#10b981]">
                  ${totalSalesVolume.toFixed(2)}
                </div>
                <p className="text-[11px] text-[#64748b]">
                  Órdenes pagadas en la semana actual
                </p>
              </div>
              <div className="w-12 h-12 rounded-2xl bg-[#10b981]/15 border border-[#10b981]/30 flex items-center justify-center text-[#10b981] shrink-0">
                <span className="material-symbols-outlined text-[24px]">inbox</span>
              </div>
            </div>

            {/* Cantidad de Ventas (Blue) */}
            <div className="bg-[#0f172a] border border-[#388bfd]/30 rounded-2xl p-5 flex items-center justify-between shadow-lg relative overflow-hidden">
              <div className="space-y-1">
                <span className="text-[10px] font-bold text-[#94a3b8] uppercase tracking-wider block">
                  CANTIDAD DE VENTAS
                </span>
                <div className="text-3xl font-black font-mono text-[#388bfd]">
                  {weeklySalesOrders.length}
                </div>
                <p className="text-[11px] text-[#64748b]">
                  Ventas procesadas esta semana
                </p>
              </div>
              <div className="w-12 h-12 rounded-2xl bg-[#388bfd]/15 border border-[#388bfd]/30 flex items-center justify-center text-[#388bfd] shrink-0">
                <span className="material-symbols-outlined text-[24px]">trending_up</span>
              </div>
            </div>

            {/* Promedio por Venta (Amber) */}
            <div className="bg-[#0f172a] border border-[#f59e0b]/30 rounded-2xl p-5 flex items-center justify-between shadow-lg relative overflow-hidden">
              <div className="space-y-1">
                <span className="text-[10px] font-bold text-[#94a3b8] uppercase tracking-wider block">
                  PROMEDIO POR VENTA
                </span>
                <div className="text-3xl font-black font-mono text-[#f59e0b]">
                  ${averageSalesTicket.toFixed(2)}
                </div>
                <p className="text-[11px] text-[#64748b]">
                  Ticket promedio semanal
                </p>
              </div>
              <div className="w-12 h-12 rounded-2xl bg-[#f59e0b]/15 border border-[#f59e0b]/30 flex items-center justify-center text-[#f59e0b] shrink-0">
                <span className="material-symbols-outlined text-[24px]">attach_money</span>
              </div>
            </div>
          </div>

          {/* Ventas Pagadas Table Card */}
          <div className="bg-[#0f172a] border border-[#1e293b] rounded-2xl overflow-hidden shadow-xl">
            <div className="p-4 sm:p-5 bg-[#111827] border-b border-[#1e293b] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="font-bold text-sm sm:text-base text-white">Ventas Pagadas de la Semana</h3>
                <span className="text-xs text-[#94a3b8] font-mono">
                  Semana Actual · {weeklySalesOrders.length} ventas
                </span>
              </div>
              <button
                onClick={handleExportPdf}
                disabled={isGeneratingPdf}
                className="bg-[#10b981]/15 hover:bg-[#10b981]/25 text-[#34d399] border border-[#10b981]/35 font-bold text-xs py-2 px-3.5 rounded-xl transition-all cursor-pointer flex items-center gap-1.5 shadow-sm disabled:opacity-50"
              >
                <span className="material-symbols-outlined text-[17px]">
                  {isGeneratingPdf ? 'hourglass_top' : 'picture_as_pdf'}
                </span>
                <span>{isGeneratingPdf ? 'Generando PDF...' : 'Descargar PDF Ventas'}</span>
              </button>
            </div>

            <div className="table-responsive-wrapper custom-scrollbar">
              <table className="w-full text-left text-xs min-w-[750px]">
                <thead className="bg-[#0b1329] text-[#94a3b8] uppercase text-[10px] tracking-wider border-b border-[#1e293b]">
                  <tr>
                    <th className="py-3.5 px-4">CLIENTE</th>
                    <th className="py-3.5 px-4">AÑO</th>
                    <th className="py-3.5 px-4">MARCA</th>
                    <th className="py-3.5 px-4">MODELO</th>
                    <th className="py-3.5 px-4">TIPO PIEZA</th>
                    <th className="py-3.5 px-4">SPECS</th>
                    <th className="py-3.5 px-4 text-right">MONTO</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1e293b] text-[#cbd5e1]">
                  {weeklySalesOrders.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-10 text-center text-xs text-[#94a3b8] italic">
                        No se registran ventas pagadas en el rango de la semana actual.
                      </td>
                    </tr>
                  ) : (
                    weeklySalesOrders.map((order) => {
                      const amount = order.financials?.total || order.financials?.partPrice || 0;
                      return (
                        <tr key={order.id} className="hover:bg-[#1e293b]/40 transition-colors">
                          <td className="py-3.5 px-4 font-bold text-white">
                            {order.customer.name}
                          </td>
                          <td className="py-3.5 px-4 font-mono text-[#cbd5e1]">
                            {order.vehicle.year}
                          </td>
                          <td className="py-3.5 px-4 text-[#cbd5e1]">
                            {order.vehicle.make}
                          </td>
                          <td className="py-3.5 px-4 text-[#cbd5e1]">
                            {order.vehicle.model}
                          </td>
                          <td className="py-3.5 px-4 font-medium text-white">{order.mainPart}</td>
                          <td className="py-3.5 px-4 text-[#94a3b8] text-[11px] max-w-xs truncate">
                            {order.productSpecs || `${order.vehicle.trim || ''} ${order.vehicle.transmission || ''}`.trim() || '—'}
                          </td>
                          <td className="py-3.5 px-4 text-right font-mono font-bold text-[#10b981]">
                            ${amount.toFixed(2)}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>

              {/* Subtotal Row */}
              <div className="bg-[#0b1329] border-t border-[#1e293b] py-3.5 px-6 flex items-center justify-end gap-3 text-xs">
                <span className="font-bold text-[#94a3b8] uppercase tracking-wider">
                  Subtotal Ventas:
                </span>
                <span className="font-mono font-black text-sm text-[#10b981]">
                  $ {totalSalesVolume.toFixed(2)}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* SUB-TAB 3: ENTREGAS DE LA SEMANA (IMAGE 3)                            */}
      {/* ===================================================================== */}
      {activeTab === 'deliveries' && (
        <div className="space-y-6">
          {/* 3 Executive KPI Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Total Recaudado por Entregas (Blue) */}
            <div className="bg-[#0f172a] border border-[#388bfd]/30 rounded-2xl p-5 flex items-center justify-between shadow-lg relative overflow-hidden">
              <div className="space-y-1">
                <span className="text-[10px] font-bold text-[#94a3b8] uppercase tracking-wider block">
                  TOTAL RECAUDADO POR ENTREGAS
                </span>
                <div className="text-3xl font-black font-mono text-[#388bfd]">
                  ${totalDeliveredCollected.toFixed(2)}
                </div>
                <p className="text-[11px] text-[#64748b]">
                  Monto cobrado de repuestos entregados
                </p>
              </div>
              <div className="w-12 h-12 rounded-2xl bg-[#388bfd]/15 border border-[#388bfd]/30 flex items-center justify-center text-[#388bfd] shrink-0">
                <span className="material-symbols-outlined text-[24px]">inventory_2</span>
              </div>
            </div>

            {/* Piezas Entregadas (Green) */}
            <div className="bg-[#0f172a] border border-[#10b981]/30 rounded-2xl p-5 flex items-center justify-between shadow-lg relative overflow-hidden">
              <div className="space-y-1">
                <span className="text-[10px] font-bold text-[#94a3b8] uppercase tracking-wider block">
                  PIEZAS ENTREGADAS
                </span>
                <div className="text-3xl font-black font-mono text-[#10b981]">
                  {weeklyDeliveriesOrders.length}
                </div>
                <p className="text-[11px] text-[#64748b]">
                  Repuestos despachados esta semana
                </p>
              </div>
              <div className="w-12 h-12 rounded-2xl bg-[#10b981]/15 border border-[#10b981]/30 flex items-center justify-center text-[#10b981] shrink-0">
                <span className="material-symbols-outlined text-[24px]">check_circle</span>
              </div>
            </div>

            {/* Promedio por Pieza (Amber) */}
            <div className="bg-[#0f172a] border border-[#f59e0b]/30 rounded-2xl p-5 flex items-center justify-between shadow-lg relative overflow-hidden">
              <div className="space-y-1">
                <span className="text-[10px] font-bold text-[#94a3b8] uppercase tracking-wider block">
                  PROMEDIO POR PIEZA
                </span>
                <div className="text-3xl font-black font-mono text-[#f59e0b]">
                  ${averageDeliveryValue.toFixed(2)}
                </div>
                <p className="text-[11px] text-[#64748b]">
                  Valor promedio por repuesto
                </p>
              </div>
              <div className="w-12 h-12 rounded-2xl bg-[#f59e0b]/15 border border-[#f59e0b]/30 flex items-center justify-center text-[#f59e0b] shrink-0">
                <span className="material-symbols-outlined text-[24px]">attach_money</span>
              </div>
            </div>
          </div>

          {/* Repuestos Entregados Table Card */}
          <div className="bg-[#0f172a] border border-[#1e293b] rounded-2xl overflow-hidden shadow-xl">
            <div className="p-4 sm:p-5 bg-[#111827] border-b border-[#1e293b] flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <h3 className="font-bold text-sm sm:text-base text-white">Repuestos Entregados en la Semana</h3>
              <span className="text-xs text-[#94a3b8] font-mono">
                Semana Actual · {weeklyDeliveriesOrders.length} entregas
              </span>
            </div>

            <div className="table-responsive-wrapper custom-scrollbar">
              <table className="w-full text-left text-xs min-w-[850px]">
                <thead className="bg-[#0b1329] text-[#94a3b8] uppercase text-[10px] tracking-wider border-b border-[#1e293b]">
                  <tr>
                    <th className="py-3.5 px-4">ORDEN / FECHA ENTREGA</th>
                    <th className="py-3.5 px-4">CLIENTE</th>
                    <th className="py-3.5 px-4">VEHÍCULO</th>
                    <th className="py-3.5 px-4">REPUESTO / DESCRIPCIÓN</th>
                    <th className="py-3.5 px-4 text-right">ABONO</th>
                    <th className="py-3.5 px-4 text-right">RESTANTE</th>
                    <th className="py-3.5 px-4 text-right">VALOR PIEZA</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1e293b] text-[#cbd5e1]">
                  {weeklyDeliveriesOrders.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-10 text-center text-xs text-[#94a3b8] italic">
                        No se registran entregas en la semana actual.
                      </td>
                    </tr>
                  ) : (
                    weeklyDeliveriesOrders.map((order) => {
                      const total = order.financials?.total || order.financials?.partPrice || 0;
                      const down = order.financials?.downPayment || 0;
                      const remaining = Math.max(0, total - down);

                      return (
                        <tr key={order.id} className="hover:bg-[#1e293b]/40 transition-colors">
                          <td className="py-3.5 px-4">
                            <div className="font-mono font-bold text-[#388bfd]">{order.code}</div>
                            <div className="text-[10px] text-[#64748b]">
                              {order.deliveredAt || order.createdAt}
                            </div>
                          </td>
                          <td className="py-3.5 px-4 font-semibold text-white">
                            {order.customer.name}
                          </td>
                          <td className="py-3.5 px-4">
                            {order.vehicle.year} {order.vehicle.make} {order.vehicle.model}
                          </td>
                          <td className="py-3.5 px-4">
                            <span className="font-medium text-white">{order.mainPart}</span>
                            {order.productSpecs && (
                              <span className="text-[#94a3b8] text-[11px] block truncate max-w-xs">
                                {order.productSpecs}
                              </span>
                            )}
                          </td>
                          <td className="py-3.5 px-4 text-right font-mono text-[#38bdf8]">
                            ${down.toFixed(2)}
                          </td>
                          <td className="py-3.5 px-4 text-right font-mono font-bold text-[#f59e0b]">
                            ${remaining.toFixed(2)}
                          </td>
                          <td className="py-3.5 px-4 text-right font-mono font-bold text-white">
                            ${total.toFixed(2)}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* SUB-TAB 4: RELACIÓN GENERAL DE ENTREGAS Y GASTOS (IMAGE 4)            */}
      {/* ===================================================================== */}
      {activeTab === 'general' && (
        <div className="space-y-6">
          {/* 3 Executive KPI Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Ingresos por Entregas (Green) */}
            <div className="bg-[#0f172a] border border-[#10b981]/30 rounded-2xl p-5 flex items-center justify-between shadow-lg relative overflow-hidden">
              <div className="space-y-1">
                <span className="text-[10px] font-bold text-[#94a3b8] uppercase tracking-wider block">
                  INGRESOS POR ENTREGAS
                </span>
                <div className="text-3xl font-black font-mono text-[#10b981]">
                  ${totalDeliveredCollected.toFixed(2)}
                </div>
                <p className="text-[11px] text-[#64748b]">Semana en curso</p>
              </div>
              <div className="w-12 h-12 rounded-2xl bg-[#10b981]/15 border border-[#10b981]/30 flex items-center justify-center text-[#10b981] shrink-0">
                <span className="material-symbols-outlined text-[24px]">trending_up</span>
              </div>
            </div>

            {/* Gastos Operativos + Comisiones (Red) */}
            <div className="bg-[#0f172a] border border-[#ef4444]/30 rounded-2xl p-5 flex items-center justify-between shadow-lg relative overflow-hidden">
              <div className="space-y-1">
                <span className="text-[10px] font-bold text-[#94a3b8] uppercase tracking-wider block">
                  GASTOS OPERATIVOS + COMISIONES
                </span>
                <div className="text-3xl font-black font-mono text-[#ef4444]">
                  ${totalExpensesWithCommission.toFixed(2)}
                </div>
                <p className="text-[11px] text-[#64748b]">
                  Incluye 2% comisión gerente (${managerCommission.toFixed(2)}) + {allGeneralConcepts.length} egresos
                </p>
              </div>
              <div className="w-12 h-12 rounded-2xl bg-[#ef4444]/15 border border-[#ef4444]/30 flex items-center justify-center text-[#ef4444] shrink-0">
                <span className="material-symbols-outlined text-[24px]">trending_down</span>
              </div>
            </div>

            {/* Balance Neto Semanal (Red / Green) */}
            <div className={`bg-[#0f172a] border ${
              netWeeklyBalance >= 0 ? 'border-[#10b981]/40' : 'border-[#ef4444]/40'
            } rounded-2xl p-5 flex items-center justify-between shadow-lg relative overflow-hidden`}>
              <div className="space-y-1">
                <span className="text-[10px] font-bold text-[#94a3b8] uppercase tracking-wider block">
                  BALANCE NETO SEMANAL
                </span>
                <div className={`text-3xl font-black font-mono ${
                  netWeeklyBalance >= 0 ? 'text-[#10b981]' : 'text-[#ef4444]'
                }`}>
                  {netWeeklyBalance >= 0 ? `$${netWeeklyBalance.toFixed(2)}` : `-$${Math.abs(netWeeklyBalance).toFixed(2)}`}
                </div>
                <p className="text-[11px] text-[#64748b]">
                  {netWeeklyBalance >= 0 ? 'Superávit Semanal' : 'Déficit Semanal'}
                </p>
              </div>
              <div className={`w-12 h-12 rounded-2xl ${
                netWeeklyBalance >= 0 ? 'bg-[#10b981]/15 text-[#10b981] border border-[#10b981]/30' : 'bg-[#ef4444]/15 text-[#ef4444] border border-[#ef4444]/30'
              } flex items-center justify-center shrink-0`}>
                <span className="material-symbols-outlined text-[24px]">attach_money</span>
              </div>
            </div>
          </div>

          {/* Desglose General de Gastos Operativos y Comisiones Table Card */}
          <div className="bg-[#0f172a] border border-[#1e293b] rounded-2xl overflow-hidden shadow-xl">
            <div className="p-4 sm:p-5 bg-[#111827] border-b border-[#1e293b] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="font-bold text-sm sm:text-base text-white">
                  Desglose General de Gastos Operativos y Comisiones
                </h3>
                <p className="text-xs text-[#94a3b8] mt-0.5">
                  Consolidado de comisión de gerencia (2%), nómina de empleados y egresos operativos.
                </p>
              </div>
              <button
                onClick={handleExportPdf}
                disabled={isGeneratingPdf}
                className="bg-[#f59e0b]/15 hover:bg-[#f59e0b]/25 text-[#fbbf24] border border-[#f59e0b]/35 font-bold text-xs py-2 px-3.5 rounded-xl transition-all cursor-pointer flex items-center gap-1.5 shadow-sm disabled:opacity-50 shrink-0"
              >
                <span className="material-symbols-outlined text-[17px]">
                  {isGeneratingPdf ? 'hourglass_top' : 'picture_as_pdf'}
                </span>
                <span>{isGeneratingPdf ? 'Generando PDF...' : 'Descargar PDF Relación'}</span>
              </button>
            </div>

            <div className="table-responsive-wrapper custom-scrollbar">
              <table className="w-full text-left text-xs min-w-[780px]">
                <thead className="bg-[#0b1329] text-[#94a3b8] uppercase text-[10px] tracking-wider border-b border-[#1e293b]">
                  <tr>
                    <th className="py-3.5 px-4">FECHA</th>
                    <th className="py-3.5 px-4">CATEGORÍA</th>
                    <th className="py-3.5 px-4">DESCRIPCIÓN / CONCEPTO</th>
                    <th className="py-3.5 px-4">MÉTODO</th>
                    <th className="py-3.5 px-4 text-right">MONTO</th>
                    <th className="py-3.5 px-4 text-center">ACCIONES</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1e293b] text-[#cbd5e1]">
                  {/* Row 1: Fixed Manager 2% Commission Calculation */}
                  <tr className="bg-[#f59e0b]/5 hover:bg-[#f59e0b]/10 transition-colors">
                    <td className="py-3.5 px-4 font-mono text-[#cbd5e1]">
                      {new Date().toISOString().split('T')[0]}
                    </td>
                    <td className="py-3.5 px-4 font-semibold text-[#f59e0b] flex items-center gap-1.5">
                      <span className="material-symbols-outlined text-[16px]">percent</span>
                      <span>Comisiones y Bonificaciones</span>
                    </td>
                    <td className="py-3.5 px-4 font-bold text-white">
                      Comisión Fija del Gerente (2% de ${totalDeliveredCollected.toFixed(2)})
                    </td>
                    <td className="py-3.5 px-4">
                      <span className="px-2.5 py-1 rounded-full bg-[#f59e0b]/15 border border-[#f59e0b]/30 text-[#fbbf24] text-[10.5px] font-mono font-medium">
                        Cálculo Automático (2%)
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono font-bold text-[#ef4444]">
                      -${managerCommission.toFixed(2)}
                    </td>
                    <td className="py-3.5 px-4 text-center text-[#64748b] text-[11px] font-mono italic">
                      Fijo (2%)
                    </td>
                  </tr>

                  {/* Rows 2..N: Dynamic Employee Salaries & Additional Operational Expenses */}
                  {allGeneralConcepts.map((item) => (
                    <tr key={item.id} className="hover:bg-[#1e293b]/40 transition-colors">
                      <td className="py-3.5 px-4 font-mono text-[#94a3b8]">{item.date}</td>
                      <td className="py-3.5 px-4 font-semibold text-white">
                        {item.isEmployee ? (
                          <div className="flex items-center gap-1.5">
                            <span className="text-[#38bdf8] flex items-center gap-1">
                              <span className="material-symbols-outlined text-[15px]">person</span>
                              <span>Nómina / Personal</span>
                            </span>
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-mono bg-[#388bfd]/15 text-[#38bdf8] border border-[#388bfd]/30 font-bold">
                              Semanal
                            </span>
                          </div>
                        ) : item.isRecurring ? (
                          <div className="flex items-center gap-1.5">
                            <span className="text-[#fbbf24] flex items-center gap-1">
                              <span className="material-symbols-outlined text-[15px]">event_repeat</span>
                              <span>{item.category}</span>
                            </span>
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-mono bg-[#f59e0b]/15 text-[#fbbf24] border border-[#f59e0b]/30 font-bold">
                              Auto Mes
                            </span>
                          </div>
                        ) : (
                          item.category
                        )}
                      </td>
                      <td className="py-3.5 px-4 text-[#cbd5e1] max-w-xs truncate font-medium">
                        {item.description}
                      </td>
                      <td className="py-3.5 px-4">
                        <span className="px-2.5 py-0.5 rounded-full border border-[#334155] bg-[#1e293b] text-[#cbd5e1] font-mono text-[11px]">
                          {item.paymentMethod}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono font-bold text-[#ef4444]">
                        -${item.amount.toFixed(2)}
                      </td>
                      <td className="py-3.5 px-4 text-center print:hidden">
                        {item.isEmployee ? (
                          <button
                            onClick={() => {
                              setIsEmployeesModalOpen(true);
                              if (item.rawEmployee) {
                                handleEditEmployee(item.rawEmployee);
                              }
                            }}
                            className="p-1 text-[#38bdf8] hover:bg-[#38bdf8]/15 rounded transition-colors cursor-pointer"
                            title="Editar salario o cargo"
                          >
                            <span className="material-symbols-outlined text-[16px]">edit</span>
                          </button>
                        ) : item.isRecurring ? (
                          <button
                            onClick={() => {
                              setIsRecurringModalOpen(true);
                              if (item.rawRecurring) {
                                handleEditRecurring(item.rawRecurring);
                              }
                            }}
                            className="p-1 text-[#fbbf24] hover:bg-[#f59e0b]/15 rounded transition-colors cursor-pointer"
                            title="Editar regla de gasto recurrente"
                          >
                            <span className="material-symbols-outlined text-[16px]">edit</span>
                          </button>
                        ) : (
                          <button
                            onClick={() => handleDeleteOtherExpense(item.id)}
                            className="p-1 text-[#ef4444] hover:bg-[#ef4444]/15 rounded transition-colors cursor-pointer"
                            title="Eliminar gasto"
                          >
                            <span className="material-symbols-outlined text-[16px]">delete</span>
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Footer Total Row */}
              <div className="bg-[#0b1329] border-t-2 border-[#1e293b] py-4 px-6 flex items-center justify-end gap-3 text-xs sm:text-sm font-black">
                <span className="text-[#94a3b8] uppercase tracking-wider">
                  TOTAL EGRESOS OFICINA + COMISIONES:
                </span>
                <span className="font-mono text-base sm:text-lg text-[#ef4444]">
                  -${totalExpensesWithCommission.toFixed(2)}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}



      {/* ===================================================================== */}
      {/* MODAL 1: GESTIÓN DE EMPLEADOS Y SALARIO SEMANAL                        */}
      {/* ===================================================================== */}
      {isEmployeesModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 animate-fade-in">
          <div className="bg-[#0f172a] border border-[#1e293b] rounded-2xl w-full max-w-2xl max-h-[min(94vh,700px)] shadow-2xl overflow-hidden flex flex-col">
            {/* Modal Header */}
            <div className="bg-[#111827] border-b border-[#1e293b] p-4 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2.5">
                <span className="material-symbols-outlined text-[#38bdf8] text-[24px]">group</span>
                <div>
                  <h3 className="font-bold text-sm sm:text-base text-white">Nómina y Empleados de Oficina</h3>
                  <p className="text-[11px] text-[#94a3b8]">Gestión de personal y salarios semanales fijos</p>
                </div>
              </div>
              <button
                onClick={() => {
                  setIsEmployeesModalOpen(false);
                  setEditingEmployeeId(null);
                  setEmployeeForm({ name: '', weeklySalary: '', role: '' });
                }}
                className="text-[#94a3b8] hover:text-white p-1 cursor-pointer"
              >
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            {/* Modal Content */}
            <div className="p-5 flex-1 min-h-0 overflow-y-auto custom-scrollbar space-y-6 text-xs">
              {/* Form to Add / Edit Employee */}
              <form onSubmit={handleSaveEmployee} className="bg-[#0b1329] border border-[#1e293b] p-4 rounded-xl space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="font-bold text-xs text-white uppercase tracking-wider flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-[#388bfd] text-[16px]">
                      {editingEmployeeId ? 'edit' : 'person_add'}
                    </span>
                    <span>{editingEmployeeId ? 'Editar Empleado' : 'Registrar Nuevo Empleado'}</span>
                  </h4>
                  {editingEmployeeId && (
                    <button
                      type="button"
                      onClick={() => {
                        setEditingEmployeeId(null);
                        setEmployeeForm({ name: '', weeklySalary: '', role: '' });
                      }}
                      className="text-[11px] text-[#94a3b8] hover:text-white underline cursor-pointer"
                    >
                      Cancelar Edición
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block font-bold text-[#cbd5e1] mb-1">
                      Nombre del Empleado <span className="text-[#ef4444]">*</span>
                    </label>
                    <input
                      type="text"
                      placeholder="Ej. Juan, Carlos..."
                      value={employeeForm.name}
                      onChange={(e) => setEmployeeForm({ ...employeeForm, name: e.target.value })}
                      required
                      className="w-full bg-[#070c18] border border-[#1e293b] rounded-xl py-2 px-3 text-white placeholder:text-[#64748b] focus:outline-none focus:border-[#388bfd]"
                    />
                  </div>

                  <div>
                    <label className="block font-bold text-[#cbd5e1] mb-1">
                      Salario Semanal ($ USD) <span className="text-[#ef4444]">*</span>
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      placeholder="0.00"
                      value={employeeForm.weeklySalary}
                      onChange={(e) => setEmployeeForm({ ...employeeForm, weeklySalary: e.target.value })}
                      required
                      className="w-full bg-[#070c18] border border-[#1e293b] rounded-xl py-2 px-3 text-white font-mono placeholder:text-[#64748b] focus:outline-none focus:border-[#388bfd]"
                    />
                  </div>

                  <div>
                    <label className="block font-bold text-[#cbd5e1] mb-1">Cargo / Rol (Opcional)</label>
                    <input
                      type="text"
                      placeholder="Ej. Administración, Ventas"
                      value={employeeForm.role}
                      onChange={(e) => setEmployeeForm({ ...employeeForm, role: e.target.value })}
                      className="w-full bg-[#070c18] border border-[#1e293b] rounded-xl py-2 px-3 text-white placeholder:text-[#64748b] focus:outline-none focus:border-[#388bfd]"
                    />
                  </div>
                </div>

                <div className="flex justify-end pt-1">
                  <button
                    type="submit"
                    className="py-2 px-4 rounded-xl bg-gradient-to-r from-[#0284c7] to-[#2563eb] hover:from-[#0369a1] hover:to-[#1d4ed8] text-white font-bold text-xs cursor-pointer transition-all shadow-[0_0_12px_rgba(2,132,199,0.3)] flex items-center gap-1.5"
                  >
                    <span className="material-symbols-outlined text-[16px]">
                      {editingEmployeeId ? 'save' : 'add'}
                    </span>
                    <span>{editingEmployeeId ? 'Actualizar Empleado' : 'Agregar a la Nómina'}</span>
                  </button>
                </div>
              </form>

              {/* List of Current Employees */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="font-bold text-xs text-white uppercase tracking-wider">
                    Nómina Actual ({employees.length} empleados)
                  </h4>
                  <span className="font-mono text-xs font-bold text-[#34d399] bg-[#10b981]/15 px-2.5 py-0.5 rounded-lg border border-[#10b981]/30">
                    Total Nómina: ${totalPayrollFixed.toFixed(2)} USD / semana
                  </span>
                </div>

                <div className="border border-[#1e293b] rounded-xl overflow-hidden divide-y divide-[#1e293b] bg-[#0b1329]">
                  {sortedEmployees.length === 0 ? (
                    <div className="p-6 text-center text-xs text-[#94a3b8] italic">
                      No hay empleados registrados en la nómina. Agrega uno usando el formulario superior.
                    </div>
                  ) : (
                    sortedEmployees.map((emp) => (
                      <div
                        key={emp.id}
                        className={`p-3.5 flex items-center justify-between gap-3 hover:bg-[#1e293b]/40 transition-colors ${
                          editingEmployeeId === emp.id ? 'bg-[#388bfd]/10 border-l-4 border-l-[#388bfd]' : ''
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-lg bg-[#388bfd]/20 border border-[#388bfd]/40 flex items-center justify-center text-[#38bdf8] font-bold text-xs shrink-0">
                            {emp.name.slice(0, 2).toUpperCase()}
                          </div>
                          <div>
                            <span className="font-bold text-white text-xs block">{emp.name}</span>
                            <span className="text-[10.5px] text-[#94a3b8] block">
                              {emp.role || 'Personal de Oficina'}
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-3">
                          <span className="font-mono font-bold text-sm text-[#38bdf8]">
                            ${emp.weeklySalary.toFixed(2)} <span className="text-[10px] text-[#94a3b8] font-normal">/sem</span>
                          </span>

                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => handleEditEmployee(emp)}
                              className="p-1.5 rounded-lg bg-[#1e293b] hover:bg-[#334155] text-[#38bdf8] transition-colors cursor-pointer"
                              title="Editar"
                            >
                              <span className="material-symbols-outlined text-[16px]">edit</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteEmployee(emp.id, emp.name)}
                              className="p-1.5 rounded-lg bg-[#ef4444]/10 hover:bg-[#ef4444]/20 text-[#f87171] transition-colors cursor-pointer"
                              title="Eliminar"
                            >
                              <span className="material-symbols-outlined text-[16px]">delete</span>
                            </button>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="bg-[#111827] border-t border-[#1e293b] p-3.5 px-5 flex items-center justify-between shrink-0">
              <span className="text-[11px] text-[#94a3b8]">
                Los cambios se guardan automáticamente y actualizan todas las vistas contables.
              </span>
              <button
                type="button"
                onClick={() => {
                  setIsEmployeesModalOpen(false);
                  setEditingEmployeeId(null);
                  setEmployeeForm({ name: '', weeklySalary: '', role: '' });
                }}
                className="py-1.5 px-4 rounded-xl bg-[#1e293b] hover:bg-[#334155] text-white font-bold text-xs cursor-pointer transition-colors"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODAL 2: REGISTRAR NUEVO GASTO OPERATIVO                                */}
      {/* ===================================================================== */}
      {isNewExpenseModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 animate-fade-in">
          <div className="bg-[#0f172a] border border-[#1e293b] rounded-2xl w-full max-w-lg max-h-[min(94vh,650px)] shadow-2xl overflow-hidden flex flex-col">
            <div className="bg-[#111827] border-b border-[#1e293b] p-4 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2.5">
                <span className="material-symbols-outlined text-[#2563eb] text-[22px]">add_circle</span>
                <h3 className="font-bold text-sm text-white">Registrar Gasto Operativo</h3>
              </div>
              <button
                onClick={() => setIsNewExpenseModalOpen(false)}
                className="text-[#94a3b8] hover:text-white p-1 cursor-pointer"
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>

            <form onSubmit={handleAddExpenseSubmit} className="p-5 space-y-4 text-xs flex-1 min-h-0 overflow-y-auto custom-scrollbar">
              <div>
                <label className="block font-bold text-[#cbd5e1] mb-1">
                  Descripción del Egreso / Concepto <span className="text-[#ef4444]">*</span>
                </label>
                <input
                  type="text"
                  placeholder="Ej. Combustible Flete, Alquiler de Patio, etc."
                  value={newExpenseForm.description}
                  onChange={(e) =>
                    setNewExpenseForm({ ...newExpenseForm, description: e.target.value })
                  }
                  required
                  className="w-full bg-[#0b1329] border border-[#1e293b] rounded-xl py-2 px-3 text-white placeholder:text-[#64748b] focus:outline-none focus:border-[#388bfd]"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-[#cbd5e1] mb-1">Categoría</label>
                  <select
                    value={newExpenseForm.category}
                    onChange={(e) =>
                      setNewExpenseForm({
                        ...newExpenseForm,
                        category: e.target.value as ExpenseItem['category'],
                      })
                    }
                    className="w-full bg-[#0b1329] border border-[#1e293b] rounded-xl py-2 px-3 text-white focus:outline-none focus:border-[#388bfd]"
                  >
                    <option value="Alquiler de Oficina / Patio">Alquiler de Oficina / Patio</option>
                    <option value="Servicios (Luz / Agua / Internet)">Servicios (Luz / Agua / Internet)</option>
                    <option value="Suministros y Papelería">Suministros y Papelería</option>
                    <option value="Mantenimiento y Limpieza">Mantenimiento y Limpieza</option>
                    <option value="Gastos Administrativos">Gastos Administrativos</option>
                    <option value="Varios">Varios</option>
                  </select>
                </div>

                <div>
                  <label className="block font-bold text-[#cbd5e1] mb-1">
                    Monto en USD ($) <span className="text-[#ef4444]">*</span>
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    placeholder="0.00"
                    value={newExpenseForm.amount}
                    onChange={(e) =>
                      setNewExpenseForm({ ...newExpenseForm, amount: e.target.value })
                    }
                    required
                    className="w-full bg-[#0b1329] border border-[#1e293b] rounded-xl py-2 px-3 text-white font-mono placeholder:text-[#64748b] focus:outline-none focus:border-[#388bfd]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block font-bold text-[#cbd5e1] mb-1">Método de Pago</label>
                  <select
                    value={newExpenseForm.paymentMethod}
                    onChange={(e) =>
                      setNewExpenseForm({
                        ...newExpenseForm,
                        paymentMethod: e.target.value as ExpenseItem['paymentMethod'],
                      })
                    }
                    className="w-full bg-[#0b1329] border border-[#1e293b] rounded-xl py-2 px-3 text-white focus:outline-none"
                  >
                    <option value="Transferencia">Transferencia</option>
                    <option value="Zelle">Zelle</option>
                    <option value="Efectivo">Efectivo</option>
                    <option value="Tarjeta">Tarjeta</option>
                  </select>
                </div>

                <div>
                  <label className="block font-bold text-[#cbd5e1] mb-1">Fecha</label>
                  <input
                    type="date"
                    value={newExpenseForm.date}
                    onChange={(e) =>
                      setNewExpenseForm({ ...newExpenseForm, date: e.target.value })
                    }
                    className="w-full bg-[#0b1329] border border-[#1e293b] rounded-xl py-2 px-3 text-white focus:outline-none"
                  >
                  </input>
                </div>

                <div>
                  <label className="block font-bold text-[#cbd5e1] mb-1">Nro. Recibo / Ref</label>
                  <input
                    type="text"
                    placeholder="REC-1234 (Opcional)"
                    value={newExpenseForm.receiptNr}
                    onChange={(e) =>
                      setNewExpenseForm({ ...newExpenseForm, receiptNr: e.target.value })
                    }
                    className="w-full bg-[#0b1329] border border-[#1e293b] rounded-xl py-2 px-3 text-white focus:outline-none"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-[#1e293b]">
                <button
                  type="button"
                  onClick={() => setIsNewExpenseModalOpen(false)}
                  className="py-2 px-4 rounded-xl bg-[#1e293b] hover:bg-[#334155] text-[#cbd5e1] font-semibold cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="py-2 px-4 rounded-xl bg-gradient-to-r from-[#2563eb] to-[#1d4ed8] hover:from-[#1d4ed8] hover:to-[#1e40af] text-white font-bold cursor-pointer transition-colors shadow-[0_0_10px_rgba(37,99,235,0.3)] flex items-center gap-1.5"
                >
                  <span className="material-symbols-outlined text-[16px]">save</span>
                  <span>Guardar Gasto</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODAL 3: GESTIÓN DE GASTOS Y COBROS RECURRENTES                       */}
      {/* ===================================================================== */}
      {isRecurringModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 animate-fade-in">
          <div className="bg-[#0f172a] border border-[#1e293b] rounded-2xl w-full max-w-2xl max-h-[min(94vh,740px)] shadow-2xl overflow-hidden flex flex-col">
            {/* Modal Header */}
            <div className="bg-[#111827] border-b border-[#1e293b] p-4 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-[#f59e0b]/15 border border-[#f59e0b]/30 flex items-center justify-center text-[#fbbf24]">
                  <span className="material-symbols-outlined text-[20px]">event_repeat</span>
                </div>
                <div>
                  <h3 className="font-bold text-sm sm:text-base text-white">Gastos y Cobros Recurrentes</h3>
                  <p className="text-[11px] text-[#94a3b8]">
                    Alquiler, servicios fijos y reglas de anticipación por fin de mes o fin de semana
                  </p>
                </div>
              </div>
              <button
                onClick={() => {
                  setIsRecurringModalOpen(false);
                  setEditingRecurringId(null);
                  setRecurringForm({
                    name: '',
                    category: 'Alquiler de Oficina / Patio',
                    amount: '',
                    frequency: 'monthly',
                    monthlyDay: '30',
                    advanceIfWeekend: true,
                    active: true,
                    notes: '',
                    paymentMethod: 'Transferencia',
                  });
                }}
                className="text-[#94a3b8] hover:text-white p-1 cursor-pointer"
              >
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            {/* Modal Content */}
            <div className="p-5 flex-1 min-h-0 overflow-y-auto custom-scrollbar space-y-5 text-xs">
              {/* Weekly Recurring Payroll Overview Card */}
              <div className="bg-[#051326] border border-[#388bfd]/35 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-[0_0_20px_rgba(56,139,253,0.15)]">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl bg-[#388bfd]/20 border border-[#388bfd]/40 flex items-center justify-center text-[#38bdf8] shrink-0">
                    <span className="material-symbols-outlined text-[22px]">group</span>
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <strong className="text-white text-xs font-bold">Nómina de Empleados (Cobro Recurrente Semanal)</strong>
                      <span className="px-2 py-0.5 rounded-full bg-[#10b981]/20 border border-[#10b981]/40 text-[#34d399] text-[9.5px] font-mono font-bold">
                        ● TODAS LAS SEMANAS
                      </span>
                    </div>
                    <p className="text-[11px] text-[#94a3b8] mt-0.5">
                      Se anexa de forma 100% automática a cada relación semanal ({employees.length} empleados registrados, ordenados de mayor a menor salario).
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0 self-end sm:self-center">
                  <div className="text-right">
                    <div className="text-[10px] text-[#94a3b8] uppercase font-mono">Total Nómina</div>
                    <div className="font-mono text-base font-black text-[#38bdf8]">${totalPayrollFixed.toFixed(2)} USD</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setIsRecurringModalOpen(false);
                      setIsEmployeesModalOpen(true);
                    }}
                    className="py-1.5 px-3 rounded-xl bg-[#388bfd]/20 hover:bg-[#388bfd]/30 text-[#38bdf8] font-bold text-xs border border-[#388bfd]/40 transition-colors cursor-pointer flex items-center gap-1"
                  >
                    <span className="material-symbols-outlined text-[15px]">manage_accounts</span>
                    <span>Gestionar Nómina</span>
                  </button>
                </div>
              </div>

              {/* Informative Rule Box */}
              <div className="bg-[#040c1c] border border-cyan-500/25 rounded-xl p-3.5 flex items-start gap-3 text-cyan-300 shadow-[inset_0_0_15px_rgba(6,182,212,0.1)]">
                <span className="material-symbols-outlined text-[20px] text-cyan-400 shrink-0 mt-0.5">info</span>
                <div className="space-y-1 text-[11.5px] leading-relaxed">
                  <strong className="text-white block font-mono uppercase tracking-wider text-[10.5px]">
                    ⚡ REGLAS FINANCIERAS AUTOMÁTICAS
                  </strong>
                  <p>
                    • <strong>Nómina de Empleados:</strong> Se anexa cada semana automáticamente como pago recurrente.<br />
                    • <strong>Gastos Mensuales (Alquiler / Servicios):</strong> Fijados para el día 30 o último día de mes. Si caen en <strong>Viernes, Sábado o Domingo</strong>, el cobro se <strong>anticipa automáticamente a la semana previa</strong>.
                  </p>
                </div>
              </div>

              {/* Form to Add / Edit Recurring Expense */}
              <form onSubmit={handleSaveRecurring} className="bg-[#0b1329] border border-[#1e293b] p-4 rounded-xl space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="font-bold text-xs text-white uppercase tracking-wider flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-[#fbbf24] text-[16px]">
                      {editingRecurringId ? 'edit' : 'add_circle'}
                    </span>
                    <span>{editingRecurringId ? 'Editar Gasto Recurrente' : 'Nuevo Gasto Recurrente'}</span>
                  </h4>
                  {editingRecurringId && (
                    <button
                      type="button"
                      onClick={() => {
                        setEditingRecurringId(null);
                        setRecurringForm({
                          name: '',
                          category: 'Alquiler de Oficina / Patio',
                          amount: '',
                          frequency: 'monthly',
                          monthlyDay: '30',
                          advanceIfWeekend: true,
                          active: true,
                          notes: '',
                          paymentMethod: 'Transferencia',
                        });
                      }}
                      className="text-[11px] text-[#94a3b8] hover:text-white underline cursor-pointer"
                    >
                      Cancelar Edición
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block font-bold text-[#cbd5e1] mb-1">
                      Concepto / Nombre del Gasto <span className="text-[#ef4444]">*</span>
                    </label>
                    <input
                      type="text"
                      placeholder="Ej. Alquiler de Local, Internet Fibra, etc."
                      value={recurringForm.name}
                      onChange={(e) => setRecurringForm({ ...recurringForm, name: e.target.value })}
                      required
                      className="w-full bg-[#070c18] border border-[#1e293b] rounded-xl py-2 px-3 text-white placeholder:text-[#64748b] focus:outline-none focus:border-[#f59e0b]"
                    />
                  </div>

                  <div>
                    <label className="block font-bold text-[#cbd5e1] mb-1">Categoría</label>
                    <select
                      value={recurringForm.category}
                      onChange={(e) =>
                        setRecurringForm({
                          ...recurringForm,
                          category: e.target.value as RecurringExpense['category'],
                        })
                      }
                      className="w-full bg-[#070c18] border border-[#1e293b] rounded-xl py-2 px-3 text-white focus:outline-none focus:border-[#f59e0b]"
                    >
                      <option value="Nómina / Pago de Empleados">Nómina / Pago de Empleados</option>
                      <option value="Alquiler de Oficina / Patio">Alquiler de Oficina / Patio</option>
                      <option value="Servicios (Luz / Agua / Internet)">Servicios (Luz / Agua / Internet)</option>
                      <option value="Suministros y Papelería">Suministros y Papelería</option>
                      <option value="Mantenimiento y Limpieza">Mantenimiento y Limpieza</option>
                      <option value="Gastos Administrativos">Gastos Administrativos</option>
                      <option value="Varios">Varios</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block font-bold text-[#cbd5e1] mb-1">
                      Monto ($ USD) <span className="text-[#ef4444]">*</span>
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      placeholder="0.00"
                      value={recurringForm.amount}
                      onChange={(e) => setRecurringForm({ ...recurringForm, amount: e.target.value })}
                      required
                      className="w-full bg-[#070c18] border border-[#1e293b] rounded-xl py-2 px-3 text-white font-mono placeholder:text-[#64748b] focus:outline-none focus:border-[#f59e0b]"
                    />
                  </div>

                  <div>
                    <label className="block font-bold text-[#cbd5e1] mb-1">Frecuencia</label>
                    <select
                      value={recurringForm.frequency}
                      onChange={(e) =>
                        setRecurringForm({
                          ...recurringForm,
                          frequency: e.target.value as RecurringExpense['frequency'],
                        })
                      }
                      className="w-full bg-[#070c18] border border-[#1e293b] rounded-xl py-2 px-3 text-white focus:outline-none focus:border-[#f59e0b]"
                    >
                      <option value="monthly">Mensual (Día Fijo)</option>
                      <option value="weekly">Semanal (Todas las semanas)</option>
                    </select>
                  </div>

                  {recurringForm.frequency === 'monthly' ? (
                    <div>
                      <label className="block font-bold text-[#cbd5e1] mb-1">
                        Día de Pago (Mes)
                      </label>
                      <input
                        type="number"
                        min={1}
                        max={31}
                        placeholder="30"
                        value={recurringForm.monthlyDay}
                        onChange={(e) => setRecurringForm({ ...recurringForm, monthlyDay: e.target.value })}
                        className="w-full bg-[#070c18] border border-[#1e293b] rounded-xl py-2 px-3 text-white font-mono focus:outline-none focus:border-[#f59e0b]"
                      />
                    </div>
                  ) : (
                    <div>
                      <label className="block font-bold text-[#cbd5e1] mb-1">Método</label>
                      <select
                        value={recurringForm.paymentMethod}
                        onChange={(e) =>
                          setRecurringForm({
                            ...recurringForm,
                            paymentMethod: e.target.value as RecurringExpense['paymentMethod'],
                          })
                        }
                        className="w-full bg-[#070c18] border border-[#1e293b] rounded-xl py-2 px-3 text-white focus:outline-none focus:border-[#f59e0b]"
                      >
                        <option value="Transferencia">Transferencia</option>
                        <option value="Zelle">Zelle</option>
                        <option value="Efectivo">Efectivo</option>
                        <option value="Tarjeta">Tarjeta</option>
                      </select>
                    </div>
                  )}
                </div>

                {recurringForm.frequency === 'monthly' && (
                  <div className="pt-1">
                    <label className="flex items-center gap-2 text-xs text-[#cbd5e1] cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={recurringForm.advanceIfWeekend}
                        onChange={(e) => setRecurringForm({ ...recurringForm, advanceIfWeekend: e.target.checked })}
                        className="w-4 h-4 rounded bg-[#070c18] border-[#1e293b] text-[#f59e0b] focus:ring-0 cursor-pointer"
                      />
                      <span>
                        Anticipar cobro a la semana anterior si el día de pago cae en <strong>Viernes, Sábado o Domingo</strong>.
                      </span>
                    </label>
                  </div>
                )}

                <div className="flex justify-end pt-1">
                  <button
                    type="submit"
                    className="py-2 px-4 rounded-xl bg-gradient-to-r from-[#d97706] to-[#f59e0b] hover:from-[#b45309] hover:to-[#d97706] text-slate-950 font-bold text-xs cursor-pointer transition-all shadow-[0_0_12px_rgba(245,158,11,0.3)] flex items-center gap-1.5"
                  >
                    <span className="material-symbols-outlined text-[16px]">
                      {editingRecurringId ? 'save' : 'add'}
                    </span>
                    <span>{editingRecurringId ? 'Actualizar Regla' : 'Registrar Gasto Recurrente'}</span>
                  </button>
                </div>
              </form>

              {/* List of Registered Recurring Expenses */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="font-bold text-xs text-white uppercase tracking-wider">
                    Gastos Recurrentes Registrados ({recurringExpenses.length})
                  </h4>
                  <span className="font-mono text-xs font-bold text-[#fbbf24] bg-[#f59e0b]/15 px-2.5 py-0.5 rounded-lg border border-[#f59e0b]/30">
                    Fijos: ${recurringExpenses.filter((r) => r.active).reduce((s, r) => s + r.amount, 0).toFixed(2)} USD
                  </span>
                </div>

                <div className="border border-[#1e293b] rounded-xl overflow-hidden divide-y divide-[#1e293b] bg-[#0b1329]">
                  {recurringExpenses.length === 0 ? (
                    <div className="p-6 text-center text-xs text-[#94a3b8] italic">
                      No hay gastos recurrentes configurados. Agrega uno usando el formulario superior.
                    </div>
                  ) : (
                    recurringExpenses.map((rec) => {
                      const isDueNow = isRecurringExpenseDueInWeek(rec, currentWeekRange);
                      const now = new Date();
                      const nextDue = getMonthlyRecurringDueWeek(
                        now.getFullYear(),
                        now.getMonth(),
                        rec.monthlyDay || 30,
                        rec.advanceIfWeekend ?? true
                      );
                      const nextStartStr = `${nextDue.start.getDate().toString().padStart(2, '0')} ${nextDue.start.toLocaleDateString('es-ES', { month: 'short' })}`;
                      const nextEndStr = `${nextDue.end.getDate().toString().padStart(2, '0')} ${nextDue.end.toLocaleDateString('es-ES', { month: 'short' })}`;

                      return (
                        <div
                          key={rec.id}
                          className={`p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-[#1e293b]/40 transition-colors ${
                            editingRecurringId === rec.id ? 'bg-[#f59e0b]/10 border-l-4 border-l-[#f59e0b]' : ''
                          }`}
                        >
                          <div className="flex items-start gap-3">
                            <div className={`w-8 h-8 rounded-lg flex items-center justify-center font-bold text-xs shrink-0 mt-0.5 ${
                              rec.active
                                ? 'bg-[#f59e0b]/20 border border-[#f59e0b]/40 text-[#fbbf24]'
                                : 'bg-[#1e293b] border border-[#334155] text-[#64748b]'
                            }`}>
                              <span className="material-symbols-outlined text-[18px]">
                                {rec.category === 'Alquiler de Oficina / Patio' ? 'home_work' : 'event_repeat'}
                              </span>
                            </div>
                            <div>
                              <div className="flex items-center gap-2">
                                <span className={`font-bold text-xs ${rec.active ? 'text-white' : 'text-[#64748b] line-through'}`}>
                                  {rec.name}
                                </span>
                                {isDueNow && (
                                  <span className="px-2 py-0.5 rounded-full bg-[#10b981]/20 border border-[#10b981]/40 text-[#34d399] text-[9.5px] font-mono font-bold animate-pulse">
                                    ● APLICA ESTA SEMANA
                                  </span>
                                )}
                              </div>
                              <span className="text-[10.5px] text-[#94a3b8] block mt-0.5">
                                {rec.category} • {rec.frequency === 'monthly' ? `Día ${rec.monthlyDay || 30} de cada mes` : 'Semanal'}
                                {rec.advanceIfWeekend ? ' • Anticipar si fin de semana' : ''}
                              </span>
                              {rec.frequency === 'monthly' && (
                                <span className="text-[10px] font-mono text-[#38bdf8] block mt-0.5">
                                  📅 Imputación este mes: Semana {nextStartStr} - {nextEndStr}{' '}
                                  {nextDue.wasAdvanced ? '(Anticipado por caer fin de semana)' : ''}
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="flex items-center justify-between sm:justify-end gap-3 self-stretch sm:self-auto pt-2 sm:pt-0 border-t sm:border-t-0 border-[#1e293b]">
                            <span className="font-mono font-bold text-sm text-[#fbbf24]">
                              ${rec.amount.toFixed(2)}{' '}
                              <span className="text-[10px] text-[#94a3b8] font-normal">
                                {rec.frequency === 'monthly' ? '/mes' : '/sem'}
                              </span>
                            </span>

                            <div className="flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => handleToggleRecurringActive(rec.id)}
                                className={`px-2 py-1 rounded-lg text-[10px] font-mono font-bold transition-colors cursor-pointer ${
                                  rec.active
                                    ? 'bg-[#10b981]/15 text-[#34d399] border border-[#10b981]/30 hover:bg-[#10b981]/25'
                                    : 'bg-[#1e293b] text-[#64748b] border border-[#334155] hover:bg-[#334155]'
                                }`}
                              >
                                {rec.active ? 'Activo' : 'Pausado'}
                              </button>
                              <button
                                type="button"
                                onClick={() => handleEditRecurring(rec)}
                                className="p-1.5 rounded-lg bg-[#1e293b] hover:bg-[#334155] text-[#38bdf8] transition-colors cursor-pointer"
                                title="Editar"
                              >
                                <span className="material-symbols-outlined text-[16px]">edit</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteRecurring(rec.id, rec.name)}
                                className="p-1.5 rounded-lg bg-[#ef4444]/10 hover:bg-[#ef4444]/20 text-[#f87171] transition-colors cursor-pointer"
                                title="Eliminar"
                              >
                                <span className="material-symbols-outlined text-[16px]">delete</span>
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="bg-[#111827] border-t border-[#1e293b] p-3.5 px-5 flex items-center justify-between shrink-0">
              <span className="text-[11px] text-[#94a3b8]">
                Los gastos recurrentes activos se calculan e integran automáticamente en la semana correspondiente.
              </span>
              <button
                type="button"
                onClick={() => {
                  setIsRecurringModalOpen(false);
                  setEditingRecurringId(null);
                  setRecurringForm({
                    name: '',
                    category: 'Alquiler de Oficina / Patio',
                    amount: '',
                    frequency: 'monthly',
                    monthlyDay: '30',
                    advanceIfWeekend: true,
                    active: true,
                    notes: '',
                    paymentMethod: 'Transferencia',
                  });
                }}
                className="py-1.5 px-4 rounded-xl bg-[#1e293b] hover:bg-[#334155] text-white font-bold text-xs cursor-pointer transition-colors"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
