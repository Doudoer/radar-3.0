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
import {
  recordDownpaymentCommission,
  recordDeliveryCommission,
  releaseOrVoidYardCommissions,
  syncCommissionsSinceDate,
  getUserCommissionsSummary,
  getUserCarryoverDebt,
  saveUserCarryoverDebt,
  syncRefundCommissions,
} from '../src/server/commissions';

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

  describe('Server Commissions Engine (src/server/commissions.ts)', () => {
    it('recordDownpaymentCommission records commission for non-yard employee', async () => {
      const executed: any[] = [];
      const mockPool: any = {
        query: async (sql: string) => {
          if (sql.includes('FROM users')) return [[{ role: 'operator' }]];
          return [[]];
        },
        execute: async (sql: string, params: any[]) => {
          executed.push({ sql, params });
          return [{ insertId: 1 }];
        },
      };

      const ok = await recordDownpaymentCommission(mockPool, {
        orderId: 101,
        userId: 5,
        isYardSale: false,
      });

      expect(ok).toBe(true);
      expect(executed.length).toBe(1);
      expect(executed[0].sql).toContain('employee_commissions');
      expect(executed[0].params[2]).toBe(5.0);
    });

    it('recordDownpaymentCommission rejects yard employee or yard sale', async () => {
      const mockPool: any = {
        query: async () => [[{ role: 'vendedor_yarda' }]],
        execute: async () => [{ insertId: 1 }],
      };

      const yardSaleOk = await recordDownpaymentCommission(mockPool, {
        orderId: 101,
        userId: 5,
        isYardSale: true,
      });
      expect(yardSaleOk).toBe(false);

      const yardUserOk = await recordDownpaymentCommission(mockPool, {
        orderId: 101,
        userId: 5,
        isYardSale: false,
      });
      expect(yardUserOk).toBe(false);
    });

    it('recordDeliveryCommission awards $2 ONLY if order was sold in the same week period as delivery', async () => {
      const executed: any[] = [];
      const deliveryDate = new Date('2026-11-25T15:00:00Z');
      const sameWeekSaleDate = new Date('2026-11-23T10:00:00Z');

      const mockPool: any = {
        query: async (sql: string) => {
          if (sql.includes('FROM users')) return [[{ role: 'operator' }]];
          if (sql.includes('FROM orders')) return [[{ created_at: sameWeekSaleDate.toISOString() }]];
          return [[]];
        },
        execute: async (sql: string, params: any[]) => {
          executed.push({ sql, params });
          return [{ insertId: 1 }];
        },
      };

      const ok = await recordDeliveryCommission(mockPool, {
        orderId: 202,
        userId: 5,
        deliveredAt: deliveryDate,
      });

      expect(ok).toBe(true);
      expect(executed.some(e => e.sql.includes('INSERT INTO employee_commissions'))).toBe(true);
    });

    it('recordDeliveryCommission strictly rejects and deletes commission if order was created in a previous week', async () => {
      const executed: any[] = [];
      const deliveryDate = new Date('2026-11-25T15:00:00Z');
      const previousWeekSaleDate = new Date('2026-11-13T10:00:00Z');

      const mockPool: any = {
        query: async (sql: string) => {
          if (sql.includes('FROM users')) return [[{ role: 'operator' }]];
          if (sql.includes('FROM orders')) return [[{ created_at: previousWeekSaleDate.toISOString() }]];
          return [[]];
        },
        execute: async (sql: string, params: any[]) => {
          executed.push({ sql, params });
          return [{ affectedRows: 1 }];
        },
      };

      const ok = await recordDeliveryCommission(mockPool, {
        orderId: 303,
        userId: 5,
        deliveredAt: deliveryDate,
      });

      expect(ok).toBe(false);
      expect(executed.some(e => e.sql.includes("DELETE FROM employee_commissions WHERE order_id = ? AND type = 'delivered_closed'"))).toBe(true);
    });

    it('releaseOrVoidYardCommissions releases after 12h or voids if canceled by yard', async () => {
      const executed: any[] = [];
      const now = new Date('2026-11-25T12:00:00Z');
      const mockPool: any = {
        query: async () => [[
          {
            id: 1,
            order_id: 10,
            available_at: new Date(now.getTime() - 1000).toISOString(),
            status: 'pagado',
            workflow_data: null,
            auction_search_active: 0,
          },
          {
            id: 2,
            order_id: 11,
            available_at: new Date(now.getTime() + 10000).toISOString(),
            status: 'cancelado',
            workflow_data: JSON.stringify({ yardPieceUnavailable: true }),
            auction_search_active: 0,
          },
        ]],
        execute: async (sql: string, params: any[]) => {
          executed.push({ sql, params });
          return [{ affectedRows: 1 }];
        },
      };

      await releaseOrVoidYardCommissions(mockPool, now);

      expect(executed.some(e => e.sql.includes('voided_availability'))).toBe(true);
      expect(executed.some(e => e.sql.includes('earned'))).toBe(true);
    });

    it('getUserCommissionsSummary calculates totals correctly', async () => {
      const now = new Date('2026-11-25T12:00:00Z');
      const mockPool: any = {
        query: async (sql: string) => {
          if (sql.includes('employee_commissions c')) {
            return [[
              {
                id: 1,
                user_id: 5,
                order_id: 10,
                type: 'downpayment_sale',
                amount: '5.00',
                status: 'earned',
                available_at: now.toISOString(),
                earned_at: now.toISOString(),
                order_code: 'ORD-10',
                first_name: 'John',
                last_name: 'Doe',
              },
              {
                id: 2,
                user_id: 5,
                order_id: 11,
                type: 'delivered_closed',
                amount: '2.00',
                status: 'earned',
                available_at: now.toISOString(),
                earned_at: now.toISOString(),
                order_code: 'ORD-11',
                first_name: 'Jane',
                last_name: 'Smith',
              },
            ]];
          }
          return [[]];
        },
        execute: async () => [{ affectedRows: 0 }],
      };

      const summary = await getUserCommissionsSummary(mockPool, 5, {
        start: new Date(now.getTime() - 86400000 * 3).toISOString(),
        end: new Date(now.getTime() + 86400000 * 3).toISOString(),
      }, now);

      expect(summary.userId).toBe(5);
      expect(summary.earnedAmount).toBe(7.0);
      expect(summary.earnedCount).toBe(2);
    });

    it('manages carryover debt retrieval and persistence', async () => {
      const executed: any[] = [];
      const mockPool: any = {
        query: async () => [[
          { carryover_amount: '20.00', covered_amount: '5.00', period_end: '2026-11-28' },
        ]],
        execute: async (sql: string, params: any[]) => {
          executed.push({ sql, params });
          return [{ affectedRows: 1 }];
        },
      };

      const debt = await getUserCarryoverDebt(mockPool, 5);
      expect(debt.totalDebt).toBe(15.0);
      expect(debt.lastPeriodEnd).toBe('2026-11-28');

      await saveUserCarryoverDebt(mockPool, 5, '2026-11-28', 15.0, 5.0);
      expect(executed.length).toBe(1);
      expect(executed[0].sql).toContain('employee_penalty_carryover');
    });

    it('syncRefundCommissions voids both $5 and $2 if refund is requested in the same week as delivery (Escenario A)', async () => {
      const executed: any[] = [];
      const sameWeekDelivery = new Date('2026-11-25T14:00:00Z');
      const sameWeekRefund = new Date('2026-11-26T10:00:00Z');

      const mockPool: any = {
        query: async () => [[
          {
            refund_id: 1,
            order_id: 101,
            refund_created_at: sameWeekRefund.toISOString(),
            refund_status: 'pending',
            delivered_at: sameWeekDelivery.toISOString(),
            order_created_at: sameWeekDelivery.toISOString(),
          },
        ]],
        execute: async (sql: string, params: any[]) => {
          executed.push({ sql, params });
          return [{ affectedRows: 2 }];
        },
      };

      await syncRefundCommissions(mockPool, sameWeekRefund);

      // Should void commissions for order_id 101 with status = 'voided_availability' and notes = 'voided_refund'
      const voidCall = executed.find(e => e.sql.includes('notes = \'voided_refund\'') && e.params?.[1] === 101);
      expect(voidCall).toBeDefined();
    });

    it('syncRefundCommissions voids ONLY $2 delivered_closed if refund is requested in subsequent week (Escenario B)', async () => {
      const executed: any[] = [];
      // Delivered in previous week (e.g. Nov 18)
      const prevWeekDelivery = new Date('2026-11-18T14:00:00Z');
      // Refunded in current week (e.g. Nov 26)
      const currentWeekRefund = new Date('2026-11-26T10:00:00Z');

      const mockPool: any = {
        query: async () => [[
          {
            refund_id: 2,
            order_id: 102,
            refund_created_at: currentWeekRefund.toISOString(),
            refund_status: 'completed',
            delivered_at: prevWeekDelivery.toISOString(),
            order_created_at: prevWeekDelivery.toISOString(),
          },
        ]],
        execute: async (sql: string, params: any[]) => {
          executed.push({ sql, params });
          return [{ affectedRows: 1 }];
        },
      };

      await syncRefundCommissions(mockPool, currentWeekRefund);

      // Should void ONLY delivered_closed commission
      const voidDeliveryCall = executed.find(
        e => e.sql.includes('notes = \'voided_refund\'') &&
             e.sql.includes('type = \'delivered_closed\'') &&
             e.params?.[1] === 102
      );
      expect(voidDeliveryCall).toBeDefined();

      // Should ensure downpayment_sale is restored/kept earned
      const keepDownpaymentCall = executed.find(
        e => e.sql.includes('status = \'earned\'') &&
             e.sql.includes('type = \'downpayment_sale\'') &&
             e.params?.[0] === 102
      );
      expect(keepDownpaymentCall).toBeDefined();
    });

    it('syncRefundCommissions voids downpayment commission if order was refunded before delivery', async () => {
      const executed: any[] = [];
      const refundDate = new Date('2026-11-26T10:00:00Z');

      const mockPool: any = {
        query: async () => [[
          {
            refund_id: 3,
            order_id: 103,
            refund_created_at: refundDate.toISOString(),
            refund_status: 'pending',
            delivered_at: null,
            order_created_at: '2026-11-25T10:00:00Z',
          },
        ]],
        execute: async (sql: string, params: any[]) => {
          executed.push({ sql, params });
          return [{ affectedRows: 1 }];
        },
      };

      await syncRefundCommissions(mockPool, refundDate);

      const voidCall = executed.find(e => e.sql.includes('notes = \'voided_refund\'') && e.params?.[1] === 103);
      expect(voidCall).toBeDefined();
    });
  });
});
