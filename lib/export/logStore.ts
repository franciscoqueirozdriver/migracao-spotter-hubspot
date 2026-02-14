
// lib/export/logStore.ts
import { randomUUID } from 'crypto';

type LogEntry = {
  createdAt: number;
  lines: string[];
};

// Use globalThis to persist across hot reloads in dev or potential function re-use
const globalStore = globalThis as unknown as { __EXPORT_LOGS__: Map<string, LogEntry> };

if (!globalStore.__EXPORT_LOGS__) {
  globalStore.__EXPORT_LOGS__ = new Map();
}

const STORE = globalStore.__EXPORT_LOGS__;
const TTL_MS = 10 * 60 * 1000; // 10 minutes

export function startRun(): string {
  const runId = randomUUID();
  STORE.set(runId, { createdAt: Date.now(), lines: [] });
  cleanupLogs();
  return runId;
}

export function appendLog(runId: string, message: string) {
  const entry = STORE.get(runId);
  if (entry) {
    // Add timestamp if not present
    const line = message.startsWith('[') ? message : `[${new Date().toISOString()}] ${message}`;
    entry.lines.push(line);
  }
}

export function getLogs(runId: string): string[] {
  const entry = STORE.get(runId);
  return entry ? entry.lines : [];
}

function cleanupLogs() {
  const now = Date.now();
  for (const [id, entry] of Array.from(STORE.entries())) {
    if (now - entry.createdAt > TTL_MS) {
      STORE.delete(id);
    }
  }
}
