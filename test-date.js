const formatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Santiago",
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});
const d = new Date();
d.setDate(d.getDate() + 7);
console.log(formatter.format(d));
