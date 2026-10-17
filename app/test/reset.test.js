const assert = require('node:assert/strict');
const { parseReset } = require('../renderer/reset.js');

// Fixed "now": Sat 17 Oct 2026, 19:45 local
const NOW = new Date(2026, 9, 17, 19, 45).getTime();
const at = (ms) => { const d = new Date(ms); return `${d.getDay()} ${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`; };

assert.equal(at(parseReset('Usage limit reached — resets at 11:00 PM', NOW)), '6 17 23:00');
assert.equal(at(parseReset('limit reached, resets 3 PM', NOW)), '0 18 15:00');           // past today → tomorrow
assert.equal(at(parseReset("You're out of messages until 9:30 am", NOW)), '0 18 9:30');
assert.equal(at(parseReset('Weekly limit reached. Resets Mon 9:00 AM', NOW)), '1 19 9:00');
assert.equal(at(parseReset('Your limit resets at 21:15', NOW)), '6 17 21:15');            // 24h clock
assert.equal(parseReset('Try again in 2 hours', NOW), NOW + 2 * 3600e3);
assert.equal(parseReset('available in 45 minutes', NOW), NOW + 45 * 60e3);
assert.equal(at(parseReset('Resets at 11:00 PM', NOW)), '6 17 23:00');              // narrow nbsp
assert.equal(parseReset('You have reached your usage limit', NOW), null);
assert.equal(parseReset('resets after 5', NOW), null);                                   // ambiguous number
console.log('reset parser: all 10 cases pass');
