// Fires a test outbound call so you can hear the agent live.
// Run: npm run test-call
// Prereqs in .env: RETELL_API_KEY, RETELL_AGENT_ID, RETELL_FROM_NUMBER, TEST_TO_NUMBER
//
// ⚠️ LEGAL: only call numbers that have consented (your own phone, a client who
// asked for a demo). Do NOT use this to cold-call prospects — AI voice calls
// without prior express written consent violate the US TCPA.
import 'dotenv/config';
import { retell } from '../retell.js';

async function main() {
  const from = process.env.RETELL_FROM_NUMBER;
  const to = process.env.TEST_TO_NUMBER;
  const agentId = process.env.RETELL_AGENT_ID;
  if (!from || !to) throw new Error('Set RETELL_FROM_NUMBER and TEST_TO_NUMBER in .env (E.164 format, e.g. +14155551234).');

  console.log(`Calling ${to} from ${from}…`);
  const call = await retell.createPhoneCall({
    from_number: from,
    to_number: to,
    override_agent_id: agentId || undefined,
    metadata: { client_id: 'demo-medspa', test: true },
    retell_llm_dynamic_variables: {
      business_name: 'Demo Med Spa',
      business_hours: 'Mon–Sat 9am–6pm',
      business_address: '123 Main St',
      current_date: new Date().toISOString().slice(0, 10),
      client_id: 'demo-medspa',
    },
  });
  console.log('✅ Call placed. call_id:', call.call_id || call.id);
  console.log('   Answer your phone — the receptionist should greet you.');
}

main().catch((e) => { console.error('❌', e.message); process.exit(1); });
