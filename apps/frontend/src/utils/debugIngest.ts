/**
 * Dev-only debug log: POSTs NDJSON payload to backend, which appends to repo-root debug-031b9f.log.
 * Falls back to Cursor ingest if API is down (may not write to workspace file).
 */
const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3001';

export function debugIngest(payload: Record<string, unknown>): void {
  const body = {
    sessionId: '031b9f',
    ...payload,
    timestamp: Date.now(),
  };
  fetch(`${API_BASE}/api/debug/ingest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).catch(() => {});
  fetch('http://127.0.0.1:7792/ingest/a4e38ab2-38d4-4330-a5d9-a6797e62f352', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '031b9f' },
    body: JSON.stringify(body),
  }).catch(() => {});
}
