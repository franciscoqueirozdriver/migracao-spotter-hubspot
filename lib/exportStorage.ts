// lib/exportStorage.ts
import { join } from 'path';
import { writeFile, readFile, mkdir, readdir } from 'fs/promises';

const EXPORTS_DIR = join('/tmp', 'exports');

/**
 * Saves a file buffer to the temporary directory.
 * @param exportId The unique identifier for the export run.
 * @param fileName The name of the file to save.
 * @param data The file content as a Buffer.
 * @returns The exportId to be used as a download reference.
 */
export async function saveExport(exportId: string, fileName: string, data: Buffer): Promise<string> {
  await mkdir(EXPORTS_DIR, { recursive: true });
  const filePath = join(EXPORTS_DIR, fileName);
  await writeFile(filePath, data);
  return exportId;
}

/**
 * Retrieves an exported file from the temporary directory.
 * @param exportId The unique identifier for the export run.
 * @returns An object containing the file data and name, or null if not found.
 */
export async function getExport(exportId: string): Promise<{ data: Buffer; fileName: string } | null> {
  try {
    const files = await readdir(EXPORTS_DIR);
    // Find any file associated with this export ID (could be a .csv or .zip)
    const fileName = files.find(f => f.startsWith(exportId));

    if (!fileName) {
      console.warn(`No export file found for ID: ${exportId}`);
      return null;
    }

    const filePath = join(EXPORTS_DIR, fileName);
    const data = await readFile(filePath);
    return { data, fileName };
  } catch (error) {
    // This can happen if the /tmp directory is cleared, which is expected.
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      console.warn(`Export directory not found for ID: ${exportId}. It may have been cleared.`);
      return null;
    }
    // For other errors, re-throw them.
    throw error;
  }
}
