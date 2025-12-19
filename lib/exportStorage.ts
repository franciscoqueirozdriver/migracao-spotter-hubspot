// lib/exportStorage.ts
import { put } from '@vercel/blob';
import { join } from 'path';
import { writeFile, readFile, mkdir } from 'fs/promises';

const useVercelBlob = !!process.env.BLOB_READ_WRITE_TOKEN;

/**
 * Saves an export file.
 * @returns The download reference (URL for Blob, ID for tmp).
 */
export async function saveExport(exportId: string, fileName: string, data: Buffer): Promise<string> {
  if (useVercelBlob) {
    const blob = await put(fileName, data, { access: 'public', addRandomSuffix: false });
    return blob.url;
  } else {
    const dir = join('/tmp', 'exports');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, fileName), data);
    return exportId;
  }
}

/**
 * Retrieves an export file from tmp storage.
 * Note: Not used for Blob storage as the URL is public.
 */
export async function getExport(exportId: string): Promise<{ data: Buffer; fileName: string } | null> {
  if (useVercelBlob) return null; // Should be handled by redirect

  try {
    const dir = join('/tmp', 'exports');
    const files = await require('fs').promises.readdir(dir);
    const fileName = files.find((f: string) => f.startsWith(exportId));
    if (!fileName) return null;

    const data = await readFile(join(dir, fileName));
    return { data, fileName };
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }
}

export const isBlobStorage = useVercelBlob;
