const formatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Santiago",
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});
const d = new Date();
const parts = formatter.formatToParts(d);
const map = Object.fromEntries(parts.map(p => [p.type, p.value]));
console.log(`${map.year}-${map.month}-${map.day}`);
