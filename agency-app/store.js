// Tiny JSON-file data store. No database needed at bootstrap scale — call
// volume for the first handful of clients fits comfortably in a flat file.
// Swap for SQLite/Postgres later if you outgrow it.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';

const FILE = process.env.DATA_FILE || './data/calls.json';

function ensure() {
  const dir = dirname(FILE);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  if (!existsSync(FILE)) writeFileSync(FILE, JSON.stringify({ clients: {}, calls: [] }, null, 2));
}

export function load() {
  ensure();
  return JSON.parse(readFileSync(FILE, 'utf8'));
}

export function save(db) {
  ensure();
  writeFileSync(FILE, JSON.stringify(db, null, 2));
}

// Upsert a client config (name, average job value used for $-recovered math, business hours).
export function upsertClient(id, patch) {
  const db = load();
  db.clients[id] = { id, avgJobValue: 400, tz: 'America/New_York', ...db.clients[id], ...patch };
  save(db);
  return db.clients[id];
}

// Add or replace a call (deduped by call_id) so re-delivered webhooks don't double-count.
export function upsertCall(call) {
  if (!call || !call.call_id) return;
  const db = load();
  const i = db.calls.findIndex((c) => c.call_id === call.call_id);
  if (i >= 0) db.calls[i] = { ...db.calls[i], ...call };
  else db.calls.push(call);
  save(db);
}
