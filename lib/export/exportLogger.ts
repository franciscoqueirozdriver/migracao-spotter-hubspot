
let buffer: string[] = [];
const MAX = 500;

export function appendLog(line: string) {
  // Check if timestamp is already present to avoid double timestamping if caller adds it
  const msg = line.startsWith('[') ? line : `[${new Date().toISOString()}] ${line}`;
  buffer.push(msg);
  if (buffer.length > MAX) buffer.shift();
  console.log(msg); // Keep server logs for debugging
}

export function getLogs(limit = 200) {
  return buffer.slice(-limit);
}

export function clearLogs() {
  buffer = [];
}
