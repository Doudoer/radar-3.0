export const escapeCsvCell = (value: unknown, forceQuote = false): string => {
  const text = value == null ? '' : String(value);
  return forceQuote || /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export const serializeCsv = (rows: readonly (readonly unknown[])[]): string =>
  rows.map((row) => row.map(value => escapeCsvCell(value)).join(',')).join('\r\n');
