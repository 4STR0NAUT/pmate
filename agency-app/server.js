import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { load, upsertCall, upsertClient } from './store.js';
import { computeMetrics, toRow } from './metrics.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.static(join(__dirname, 'public')));

const DEFAULT_CLIENT = 'demo-medspa';

// --- Retell webhook receiver -------------------------------------------------
// Point your Retell agent's webhook_url at  <public-url>/webhook/retell
// Retell posts events: call_started, call_ended, call_analyzed.
app.post('/webhook/retell', (req, res) => {
  const { event, call } = req.body || {};
  if (call && call.call_id) {
    // Tag the call to a client. Map by the agent's metadata or dynamic vars in
    // production; for now fall back to the demo client.
    const clientId = call?.metadata?.client_id || call?.retell_llm_dynamic_variables?.client_id || DEFAULT_CLIENT;
    upsertCall({ ...call, client_id: clientId });
  }
  // Always 200 quickly so Retell doesn't retry-storm you.
  res.status(200).json({ received: true, event: event || null });
});

// --- Dashboard API -----------------------------------------------------------
app.get('/api/metrics', (req, res) => {
  const clientId = req.query.client || DEFAULT_CLIENT;
  const db = load();
  const client = db.clients[clientId] || { id: clientId };
  const calls = db.calls.filter((c) => (c.client_id || DEFAULT_CLIENT) === clientId);
  res.json({ client, metrics: computeMetrics(calls, client) });
});

app.get('/api/calls', (req, res) => {
  const clientId = req.query.client || DEFAULT_CLIENT;
  const db = load();
  const client = db.clients[clientId] || {};
  const rows = db.calls
    .filter((c) => (c.client_id || DEFAULT_CLIENT) === clientId)
    .map((c) => toRow(c, client.tz))
    .sort((a, b) => b.when - a.when)
    .slice(0, 50);
  res.json({ calls: rows });
});

// Configure a client (name, average job value, timezone) — drives the $ math.
app.post('/api/client', (req, res) => {
  const { id = DEFAULT_CLIENT, ...patch } = req.body || {};
  res.json({ client: upsertClient(id, patch) });
});

app.get('/api/health', (_req, res) => res.json({ ok: true, retell: Boolean(process.env.RETELL_API_KEY) }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`agency-app dashboard on http://localhost:${PORT}`));
