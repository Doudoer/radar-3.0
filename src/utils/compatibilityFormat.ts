/**
 * Helper to format year ranges for compatibility listings.
 * When a range spans multiple years (e.g. 2006 to 2008),
 * it expands all intermediate years: "2006, 2007 y 2008."
 */
export const formatYearRange = (yearFrom: number, yearTo: number): string => {
  const from = Math.min(yearFrom, yearTo);
  const to = Math.max(yearFrom, yearTo);

  if (!from || !to || from === to) {
    return `${from || to}.`;
  }

  const years: number[] = [];
  for (let y = from; y <= to; y++) {
    years.push(y);
  }

  if (years.length === 1) {
    return `${years[0]}.`;
  }

  if (years.length === 2) {
    return `${years[0]} y ${years[1]}.`;
  }

  // 3 or more years: "2006, 2007 y 2008."
  const allButLast = years.slice(0, -1).join(', ');
  const last = years[years.length - 1];
  return `${allButLast} y ${last}.`;
};

/**
 * Expands any year range patterns like "2006 y 2008" or "2006 - 2008" in pre-existing text strings
 * so that any historical compatibility records automatically render with all years explicitly enumerated.
 */
export const expandYearRangesInText = (text: string): string => {
  if (!text) return '';

  return text.replace(/\b(19\d\d|20\d\d)\s*(?:y|-|al|a)\s*(19\d\d|20\d\d)\b/gi, (match, y1Str, y2Str) => {
    const y1 = parseInt(y1Str, 10);
    const y2 = parseInt(y2Str, 10);
    if (isNaN(y1) || isNaN(y2)) return match;

    const diff = Math.abs(y2 - y1);
    if (diff > 1) {
      const from = Math.min(y1, y2);
      const to = Math.max(y1, y2);
      const years: number[] = [];
      for (let y = from; y <= to; y++) {
        years.push(y);
      }
      return `${years.slice(0, -1).join(', ')} y ${years[years.length - 1]}`;
    }
    return match;
  });
};
