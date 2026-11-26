import { describe, expect, it } from 'vitest';
import {
  settleEmployeeCompensation,
  isYardEmployee,
  DOWNPAYMENT_COMMISSION_AMOUNT,
  DELIVERY_CLOSED_COMMISSION_AMOUNT,
  YARD_VERIFICATION_HOURS,
} from '../src/utils/commissions';
import { isDuringPbxBusinessHours } from '../src/server/pbxCalls';
import { isExemptFromCallPenalties } from '../src/server/penalties';

describe('Employee Commissions & Salary Protection', () => {
  it('validates commission constants and yard exclusion', () => {
    expect(DOWNPAYMENT_COMMISSION_AMOUNT).toBe(5.0);
    expect(DELIVERY_CLOSED_COMMISSION_AMOUNT).toBe(2.0);
    expect(YARD_VERIFICATION_HOURS).toBe(12);

    expect(isYardEmployee('vendedor_yarda')).toBe(true);
    expect(isYardEmployee('Personal de Yarda')).toBe(true);
    expect(isYardEmployee('operator')).toBe(false);
    expect(isYardEmployee('admin')).toBe(false);
    expect(isYardEmployee(null)).toBe(false);
  });

  it('settles compensation when commissions exceed penalties (full deduction from commissions, 0 debt)', () => {
    const weeklySalary = 120.0;
    const earnedCommissions = 25.0; // 3 downpayments ($15) + 5 deliveries ($10)
    const penalties = 10.0;
    const previousCarryover = 0;

    const settlement = settleEmployeeCompensation(weeklySalary, earnedCommissions, penalties, previousCarryover);

    // Base salary is 100% untouched
    expect(settlement.weeklySalary).toBe(120.0);
    expect(settlement.earnedCommissions).toBe(25.0);
    expect(settlement.appliedDeduction).toBe(10.0);
    expect(settlement.netCommissions).toBe(15.0);
    expect(settlement.nextCarryoverDebt).toBe(0.0);
    expect(settlement.netPayout).toBe(135.0); // 120 + 15
  });

  it('strictly protects base salary when penalties exceed commissions (commissions capped at 0, deficit carries over)', () => {
    const weeklySalary = 120.0;
    const earnedCommissions = 5.0; // only $5 in commissions
    const penalties = 15.0; // $15 in penalties
    const previousCarryover = 0;

    const settlement = settleEmployeeCompensation(weeklySalary, earnedCommissions, penalties, previousCarryover);

    // Base salary is STILL 100% untouched
    expect(settlement.weeklySalary).toBe(120.0);
    expect(settlement.earnedCommissions).toBe(5.0);
    expect(settlement.appliedDeduction).toBe(5.0); // Only what was available in commissions
    expect(settlement.netCommissions).toBe(0.0);
    expect(settlement.nextCarryoverDebt).toBe(10.0); // Remaining $10 carries over to next Saturday
    expect(settlement.netPayout).toBe(120.0); // 100% of base salary is paid!
  });

  it('strictly protects base salary when employee has zero commissions ($0 deducted, all debt carries over)', () => {
    const weeklySalary = 100.0;
    const earnedCommissions = 0.0;
    const penalties = 12.5;
    const previousCarryover = 5.0;

    const settlement = settleEmployeeCompensation(weeklySalary, earnedCommissions, penalties, previousCarryover);

    expect(settlement.weeklySalary).toBe(100.0);
    expect(settlement.appliedDeduction).toBe(0.0);
    expect(settlement.netCommissions).toBe(0.0);
    expect(settlement.nextCarryoverDebt).toBe(17.5); // 12.5 + 5.0 carryover
    expect(settlement.netPayout).toBe(100.0); // Full base salary paid!
  });

  it('filters call penalties strictly by business hours', () => {
    // 14:00 (2:00 PM) UTC is 09:00 AM America/New_York (business hours: 8:00 - 17:00)
    const withinBusinessHours = new Date('2026-11-24T14:00:00Z');
    expect(isDuringPbxBusinessHours(withinBusinessHours)).toBe(true);

    // 01:00 UTC is 20:00 (8:00 PM) previous day America/New_York (after hours)
    const afterHours = new Date('2026-11-25T01:00:00Z');
    expect(isDuringPbxBusinessHours(afterHours)).toBe(false);

    // 08:00 UTC is 03:00 AM America/New_York (after hours)
    const middleOfNight = new Date('2026-11-25T08:00:00Z');
    expect(isDuringPbxBusinessHours(middleOfNight)).toBe(false);
  });

  it('exempts internal numbers, 169014, and 9844004618 from generating call penalties', () => {
    const knownExtensions = new Set(['201', '202', '204', '501']);

    // 169014 internal line / test number
    expect(isExemptFromCallPenalties('169014', null, 'inbound', knownExtensions)).toBe(true);
    expect(isExemptFromCallPenalties(null, '169014', 'inbound', knownExtensions)).toBe(true);
    expect(isExemptFromCallPenalties('169014', null, 'outbound', knownExtensions)).toBe(true);

    // 9844004618 office / company line in various formats
    expect(isExemptFromCallPenalties('9844004618', null, 'inbound', knownExtensions)).toBe(true);
    expect(isExemptFromCallPenalties('+19844004618', 'English:+19844004618', 'inbound', knownExtensions)).toBe(true);
    expect(isExemptFromCallPenalties('19844004618', null, 'inbound', knownExtensions)).toBe(true);
    expect(isExemptFromCallPenalties('(984) 400-4618', null, 'inbound', knownExtensions)).toBe(true);

    // Internal extensions & internal direction
    expect(isExemptFromCallPenalties('204', null, 'inbound', knownExtensions)).toBe(true);
    expect(isExemptFromCallPenalties('501', null, 'inbound', knownExtensions)).toBe(true);
    expect(isExemptFromCallPenalties('100', null, 'internal', knownExtensions)).toBe(true);
    expect(isExemptFromCallPenalties('+19195551234', null, 'internal', knownExtensions)).toBe(true);
    expect(isExemptFromCallPenalties('+19195551234', null, 'outbound', knownExtensions)).toBe(true);

    // Standard external inbound customer call must NOT be exempt
    expect(isExemptFromCallPenalties('+19195551234', 'John Doe', 'inbound', knownExtensions)).toBe(false);
    expect(isExemptFromCallPenalties('9195551234', null, 'inbound', knownExtensions)).toBe(false);
  });
});
