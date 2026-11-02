import { describe, expect, it } from 'vitest';
import { escapeCsvCell, serializeCsv } from '../src/utils/csv';

describe('CSV serialization', () => {
  it('escapes embedded quotes, commas, LF and CRLF without losing customer data', () => {
    expect(escapeCsvCell('Cliente "A", Inc.')).toBe('"Cliente ""A"", Inc."');
    expect(escapeCsvCell('line 1\nline 2')).toBe('"line 1\nline 2"');
    expect(escapeCsvCell('line 1\r\nline 2')).toBe('"line 1\r\nline 2"');
    expect(escapeCsvCell('plain')).toBe('plain');
  });

  it('preserves zero, unicode and empty values and uses CRLF between records', () => {
    expect(serializeCsv([['Nombre', 'Monto'], ['Peña, "Ana"', 0], [null, undefined]]))
      .toBe('Nombre,Monto\r\n"Peña, ""Ana""",0\r\n,');
  });
});
