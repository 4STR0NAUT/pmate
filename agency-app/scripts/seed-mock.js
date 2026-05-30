// Seeds realistic mock call data so you can see the dashboard working WITHOUT
// a Retell key yet. Run: npm run seed
import { save, upsertClient } from '../store.js';

const now = Date.now();
const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

function call(i, { afterHours = false, booked = true, service, sentiment = 'Positive', daysAgo = 0, durMin = 3 } = {}) {
  // Build a timestamp; for after-hours, push to ~8pm that day.
  const base = now - daysAgo * DAY;
  const d = new Date(base);
  if (afterHours) d.setHours(20, 15, 0, 0); else d.setHours(11, 30, 0, 0);
  const start = d.getTime();
  return {
    call_id: `mock_${i}`,
    client_id: 'demo-medspa',
    from_number: `+1415555${String(1000 + i).slice(-4)}`,
    start_timestamp: start,
    end_timestamp: start + durMin * 60 * 1000,
    call_analysis: {
      appointment_booked: booked,
      custom_analysis_data: { appointment_booked: booked, service_interest: service },
      call_summary: booked
        ? `Caller booked a ${service} appointment.`
        : `Caller asked about ${service}; details captured for follow-up.`,
      user_sentiment: sentiment,
    },
  };
}

const services = ['Botox', 'lip filler', 'HydraFacial', 'laser hair removal', 'microneedling', 'chemical peel'];
const calls = [];
let i = 0;
for (let day = 0; day < 14; day++) {
  const perDay = 2 + (day % 4); // 2–5 calls/day
  for (let k = 0; k < perDay; k++) {
    const afterHours = Math.random() < 0.4;
    const booked = Math.random() < 0.55;
    calls.push(call(i++, {
      afterHours,
      booked,
      service: services[i % services.length],
      sentiment: booked ? 'Positive' : 'Neutral',
      daysAgo: day,
      durMin: 2 + (i % 4),
    }));
  }
}

upsertClient('demo-medspa', { name: 'Demo Med Spa', avgJobValue: 450, tz: 'America/New_York' });
save({ clients: { 'demo-medspa': { id: 'demo-medspa', name: 'Demo Med Spa', avgJobValue: 450, tz: 'America/New_York' } }, calls });

console.log(`Seeded ${calls.length} mock calls for demo-medspa.`);
console.log('Start the server (npm start) and open http://localhost:3000');
