// Creates a med-spa AI receptionist on Retell: an LLM (prompt) + an agent
// wired to a voice and your webhook. Run: npm run create-agent
//
// Prereqs in .env: RETELL_API_KEY, RETELL_VOICE_ID, PUBLIC_WEBHOOK_URL
import 'dotenv/config';
import { retell } from '../retell.js';

const VOICE_ID = process.env.RETELL_VOICE_ID || '11labs-Adrian';
const WEBHOOK = process.env.PUBLIC_WEBHOOK_URL
  ? `${process.env.PUBLIC_WEBHOOK_URL.replace(/\/$/, '')}/webhook/retell`
  : undefined;

// The receptionist's brain. Tuned for a med spa: warm, concise, books or
// captures every caller, never invents medical/clinical advice.
const GENERAL_PROMPT = `You are the friendly virtual receptionist for {{business_name}}, a medical spa.
Your goals, in order:
1) Make the caller feel welcomed and understood.
2) Book an appointment, or capture their name + phone + what they're interested in so the team can follow up.
3) Answer common questions (services, pricing ranges, hours, location, parking) from the info you're given.

Rules:
- Keep replies short and natural — one or two sentences, then ask a question.
- Never give medical or clinical advice or diagnose. For clinical questions say a provider will follow up.
- If asked something you don't know, say you'll have the team confirm and capture their contact info.
- Always confirm the spelling of the caller's name and read back their phone number.
- Business hours: {{business_hours}}. Location: {{business_address}}.
Today's date is {{current_date}}.`;

const BEGIN_MESSAGE = `Thanks for calling {{business_name}}, this is the front desk — how can I help you today?`;

async function main() {
  console.log('Creating Retell LLM (prompt)…');
  const llm = await retell.createLLM({
    general_prompt: GENERAL_PROMPT,
    begin_message: BEGIN_MESSAGE,
    // Post-call analysis: this is what powers "bookings" on the dashboard.
    // Verify the exact field name for analysis config in current Retell docs.
    default_dynamic_variables: {
      business_name: 'Demo Med Spa',
      business_hours: 'Mon–Sat 9am–6pm',
      business_address: '123 Main St',
    },
  });
  const llmId = llm.llm_id || llm.id;
  console.log('  llm_id:', llmId);

  console.log('Creating agent…');
  const agent = await retell.createAgent({
    agent_name: 'Med Spa Receptionist (demo)',
    voice_id: VOICE_ID,
    response_engine: { type: 'retell-llm', llm_id: llmId },
    webhook_url: WEBHOOK,
    // Post-call analysis fields -> drives dashboard "bookings".
    post_call_analysis_data: [
      { type: 'boolean', name: 'appointment_booked', description: 'True if the caller booked or confirmed an appointment.' },
      { type: 'string', name: 'service_interest', description: 'What treatment/service the caller asked about.' },
    ],
  });
  const agentId = agent.agent_id || agent.id;

  console.log('\n✅ Agent created.');
  console.log('   agent_id:', agentId);
  console.log('   voice_id:', VOICE_ID);
  console.log('   webhook :', WEBHOOK || '(none — set PUBLIC_WEBHOOK_URL to capture calls)');
  console.log('\nNext: paste this into .env  ->  RETELL_AGENT_ID=' + agentId);
  console.log('Then assign a phone number to this agent in the Retell dashboard, or run `npm run test-call`.');
}

main().catch((e) => { console.error('\n❌', e.message); process.exit(1); });
