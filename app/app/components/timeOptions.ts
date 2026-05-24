export const TIME_OPTIONS: { value: string; label: string }[] = (() => {
  const opts: { value: string; label: string }[] = [];
  for (let hour = 8; hour <= 20; hour++) {
    for (let minute = 0; minute < 60; minute += 30) {
      const value = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
      const displayHour = hour % 12 || 12;
      const ampm = hour >= 12 ? 'PM' : 'AM';
      opts.push({ value, label: `${displayHour}:${minute.toString().padStart(2, '0')} ${ampm}` });
    }
  }
  return opts;
})();

export function normalizeTimeValue(time: string): string {
  let t = time;
  if (t.includes('T')) t = t.split('T')[1]?.split('.')[0] || t;
  if (t.includes(':')) {
    const parts = t.split(':');
    if (parts.length >= 2) t = `${parts[0].padStart(2, '0')}:${parts[1].padStart(2, '0')}`;
  }
  return t;
}
