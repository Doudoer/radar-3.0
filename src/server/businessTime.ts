export const businessDate = (value: Date | string) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date(value));

export const businessDaysBetween = (start: Date | string, end: Date | string) =>
  Math.floor((Date.parse(`${businessDate(end)}T00:00:00Z`) - Date.parse(`${businessDate(start)}T00:00:00Z`)) / 86400000);
