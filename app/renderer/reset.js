// Turns a limit message into the timestamp when the account frees up.
// Handles: "resets at 3:00 PM", "until 9 am", "resets Mon 9:00 AM", "in 2 hours", "in 45 minutes".
// Returns null if no usable time is found.
function parseReset(text, nowMs = Date.now()) {
  if (!text) return null;
  const t = String(text).replace(/[  ]/g, ' ');

  let m = t.match(/\bin\s+(\d+)\s*(hours?|hrs?|h|minutes?|mins?|m)\b/i);
  if (m) return nowMs + Number(m[1]) * (/^h/i.test(m[2]) ? 3_600_000 : 60_000);

  m = t.match(
    /(?:resets?|until|after|available)\D{0,20}?(?:\b(mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?,?\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i
  );
  if (!m || (!m[3] && !m[4])) return null;

  let hour = Number(m[2]);
  const minute = Number(m[3] || 0);
  const ampm = m[4] && m[4].toLowerCase();
  if (ampm === 'pm' && hour < 12) hour += 12;
  if (ampm === 'am' && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) return null;

  const d = new Date(nowMs);
  d.setHours(hour, minute, 0, 0);
  if (m[1]) {
    const target = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].indexOf(m[1].slice(0, 3).toLowerCase());
    d.setDate(d.getDate() + ((target - d.getDay() + 7) % 7));
  }
  if (d.getTime() <= nowMs) d.setDate(d.getDate() + (m[1] ? 7 : 1));
  return d.getTime();
}

if (typeof module !== 'undefined') module.exports = { parseReset };
