import { describe, it, expect } from 'vitest';
import { formatYearRange, expandYearRangesInText } from '../src/utils/compatibilityFormat';

describe('formatYearRange', () => {
  it('formats a single year', () => {
    expect(formatYearRange(2006, 2006)).toBe('2006.');
  });

  it('formats two consecutive years', () => {
    expect(formatYearRange(2006, 2007)).toBe('2006 y 2007.');
  });

  it('expands intermediate years for 3-year range (e.g. 2006 to 2008)', () => {
    expect(formatYearRange(2006, 2008)).toBe('2006, 2007 y 2008.');
  });

  it('expands intermediate years for larger ranges (e.g. 2006 to 2010)', () => {
    expect(formatYearRange(2006, 2010)).toBe('2006, 2007, 2008, 2009 y 2010.');
  });

  it('handles inverted ranges (from > to)', () => {
    expect(formatYearRange(2008, 2006)).toBe('2006, 2007 y 2008.');
  });
});

describe('expandYearRangesInText', () => {
  it('expands range with "y"', () => {
    const input = 'Compatibilidad\n*Honda Ridgeline: 2006 y 2008.';
    const output = expandYearRangesInText(input);
    expect(output).toBe('Compatibilidad\n*Honda Ridgeline: 2006, 2007 y 2008.');
  });

  it('expands range with hyphen', () => {
    const input = '*Honda Accord: 2003 - 2006.';
    const output = expandYearRangesInText(input);
    expect(output).toBe('*Honda Accord: 2003, 2004, 2005 y 2006.');
  });

  it('leaves two consecutive years intact', () => {
    const input = '*Honda Civic: 2006 y 2007.';
    const output = expandYearRangesInText(input);
    expect(output).toBe('*Honda Civic: 2006 y 2007.');
  });
});
