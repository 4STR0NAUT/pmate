// Thin wrapper around the Retell AI REST API.
//
// NOTE: Retell's API has evolved (v1 -> v2). These endpoints reflect the v2
// shape at the time of writing — VERIFY against the current docs before relying
// on them in production: https://docs.retellai.com/api-references
// Each method is small on purpose so you can adjust a path/field in one place.
import 'dotenv/config';

const BASE = 'https://api.retellai.com';
const KEY = process.env.RETELL_API_KEY;

async function api(path, { method = 'GET', body } = {}) {
  if (!KEY) throw new Error('RETELL_API_KEY is not set (copy .env.example -> .env and fill it in).');
  const res = await fetch(BASE + path, {
    method,
    headers: {
      Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    throw new Error(`Retell ${method} ${path} -> ${res.status}: ${typeof data === 'string' ? data : JSON.stringify(data)}`);
  }
  return data;
}

export const retell = {
  // 1) Create the "brain": the LLM + prompt the agent runs on.
  createLLM: (payload) => api('/create-retell-llm', { method: 'POST', body: payload }),

  // 2) Create the agent that wires the LLM to a voice + webhook.
  createAgent: (payload) => api('/create-agent', { method: 'POST', body: payload }),
  updateAgent: (agentId, payload) => api(`/update-agent/${agentId}`, { method: 'PATCH', body: payload }),
  getAgent: (agentId) => api(`/get-agent/${agentId}`),

  // 3) Phone numbers (list what you've bought/imported).
  listPhoneNumbers: () => api('/list-phone-numbers'),

  // 4) Outbound call — used to demo/test an agent by calling your own phone.
  createPhoneCall: (payload) => api('/v2/create-phone-call', { method: 'POST', body: payload }),

  // 5) Calls — pull history to backfill / reconcile the dashboard.
  listCalls: (filter = {}) => api('/v2/list-calls', { method: 'POST', body: filter }),
  getCall: (callId) => api(`/v2/get-call/${callId}`),
};
