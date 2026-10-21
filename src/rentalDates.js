// Customer times are Europe/Rome; Odoo datetime values are UTC.
const formatter = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Rome',
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
function utcForLocal(year, month, day, hour, minute) {
  const local = `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')} ${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')}:00`;
  const guess = Date.UTC(year, month-1, day, hour, minute);
  // Modern Italian civil time is UTC+1 or UTC+2. Ambiguous/nonexistent DST
  // times are refused instead of selecting a different rental duration.
  const candidates = [1,2].map(offset => new Date(guess-offset*3600000))
    .filter(date => formatter.format(date) === local);
  return candidates.length === 1 ? candidates[0].toISOString().slice(0,19).replace('T',' ') : null;
}
export function italianRentalDates(text) {
  const value = String(text || '');
  const dates = [...value.matchAll(/\b(0?[1-9]|[12]\d|3[01])[/.\-](0?[1-9]|1[0-2])[/.\-]((?:20)?\d{2})\b/g)];
  // Colons avoid confusing DD.MM dates with times. Unsupported input stays in review.
  const times = [...value.matchAll(/\b([01]?\d|2[0-3]):([0-5]\d)\b/g)];
  if(dates.length !== 2 || times.length !== 2) return null;
  const values = dates.map((date,index) => utcForLocal(Number(date[3])+(date[3].length===2?2000:0),Number(date[2]),Number(date[1]),Number(times[index][1]),Number(times[index][2])));
  return values.every(Boolean) && values[0] < values[1] ? { start: values[0], end: values[1] } : null;
}
