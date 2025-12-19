// lib/exportStorage.ts
import { put } from '@vercel/blob';
import { join } from 'path';
import { writeFile, readFile, mkdir, readdir } from 'fs/promises';

const isProduction = process.env.VERCEL === '1' || process.env.NODE_ENV === 'production';

/**
 * Saves an export file buffer. In production, it requires Vercel Blob.
 * In development, it falls back to the local /tmp directory.
 * @returns The download reference (public URL for Blob, exportId for tmp).
 */
export async function saveExport(exportId: string, fileName: string, data: Buffer): Promise<string> {
  if (isProduction) {
    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      throw new Error('BLOB_READ_WRITE_TOKEN não configurado; exportação indisponível em produção sem Blob.');
    }
    const blob = await put(fileName, data, { access: 'public', addRandomSuffix: false });
    return blob.url;
  } else {
    // Local development fallback
    const dir = join('/tmp', 'exports');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, fileName), data);
    return exportId;
  }
}

/**
 * Retrieves an exported file from the temporary /tmp directory (for local development).
 */
export async function getTmpExport(exportId: string): Promise<{ data: Buffer; fileName: string } | null> {
  if (isProduction) {
    // This function should not be called in production as downloads are handled via redirect
    console.warn('getTmpExport foi chamada em ambiente de produção. Isso não é esperado.');
    return null;
  }
  try {
    const dir = join('/tmp', 'exports');
    const files = await readdir(dir);
    const fileName = files.find(f => f.startsWith(exportId));
    if (!fileName) return null;
    const data = await readFile(join(dir, fileName));
    return { data, fileName };
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }
}
