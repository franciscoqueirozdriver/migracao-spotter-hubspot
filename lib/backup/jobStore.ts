
import fs from 'fs';
import path from 'path';

export const BACKUP_ROOT = path.join('/tmp', 'spotter-backup');

export interface JobStatus {
  jobId: string;
  status: 'queued' | 'running' | 'done' | 'error';
  step?: string;
  entity?: string;
  page?: number;
  totalItems?: number;
  startedAt: string;
  finishedAt?: string;
  errorMessage?: string;
  files?: FileInfo[];
}

export interface FileInfo {
  path: string;
  size: number;
  updatedAt: string;
}

export function getJobDir(jobId: string): string {
  return path.join(BACKUP_ROOT, jobId);
}

export function initJob(jobId: string): void {
  const dir = getJobDir(jobId);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    // Create subfolders
    ['core', 'events', 'dictionaries', 'sales', 'metadata'].forEach(sub => {
      fs.mkdirSync(path.join(dir, sub), { recursive: true });
    });
  }

  const initialStatus: JobStatus = {
    jobId,
    status: 'queued',
    startedAt: new Date().toISOString()
  };
  saveStatus(jobId, initialStatus);
}

export function saveStatus(jobId: string, status: JobStatus): void {
  const file = path.join(getJobDir(jobId), 'metadata', 'status.json');
  fs.writeFileSync(file, JSON.stringify(status, null, 2));
}

export function getStatus(jobId: string): JobStatus | null {
  const file = path.join(getJobDir(jobId), 'metadata', 'status.json');
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return null;
  }
}

export function listFiles(jobId: string): FileInfo[] {
  const dir = getJobDir(jobId);
  if (!fs.existsSync(dir)) return [];

  const files: FileInfo[] = [];

  function scan(currentDir: string, relativePath: string) {
    const items = fs.readdirSync(currentDir);
    for (const item of items) {
      const fullPath = path.join(currentDir, item);
      const stat = fs.statSync(fullPath);
      const itemRelPath = relativePath ? path.join(relativePath, item) : item;

      if (stat.isDirectory()) {
        scan(fullPath, itemRelPath);
      } else {
        files.push({
          path: itemRelPath,
          size: stat.size,
          updatedAt: stat.mtime.toISOString()
        });
      }
    }
  }

  scan(dir, '');
  return files;
}

/**
 * Clean up old jobs (> 24h)
 */
export function cleanupOldJobs() {
  if (!fs.existsSync(BACKUP_ROOT)) return;

  const jobs = fs.readdirSync(BACKUP_ROOT);
  const now = Date.now();
  const TTL = 24 * 60 * 60 * 1000;

  for (const job of jobs) {
    const jobDir = path.join(BACKUP_ROOT, job);
    try {
      const stat = fs.statSync(jobDir);
      if (now - stat.mtimeMs > TTL) {
        fs.rmSync(jobDir, { recursive: true, force: true });
      }
    } catch (e) {
      console.error(`Failed to cleanup job ${job}`, e);
    }
  }
}

/**
 * Validates path to prevent traversal
 */
export function validatePath(jobId: string, requestedPath: string): string | null {
  const jobRoot = path.resolve(getJobDir(jobId));
  const fullPath = path.resolve(jobRoot, requestedPath);

  if (!fullPath.startsWith(jobRoot)) {
    return null;
  }
  return fullPath;
}
