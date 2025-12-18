// lib/exportStorage.ts
import { join } from 'path';
import { writeFile, readFile, mkdir, readdir } from 'fs/promises';

const EXPORTS_DIR = join('/tmp', 'exports');

/**
 * Saves a file buffer to the temporary directory.
 * @param fileName The name of the file to save.
 * @param data The file content as a Buffer.
 */
export async function saveTemporaryFile(fileName: string, data: Buffer): Promise<void> {
  await mkdir(EXPORTS_DIR, { recursive: true });
  const filePath = join(EXPORTS_DIR, fileName);
  await writeFile(filePath, data);
}

/**
 * Retrieves an exported file from the temporary directory.
 * @param exportId The unique identifier for the export run, used to find the file.
 * @returns An object containing the file data and name, or null if not found.
 */
export async function getTemporaryFile(exportId: string): Promise<{ data: Buffer; fileName: string } | null> {
  try {
    await mkdir(EXPORTS_DIR, { recursive: true }); // Ensure directory exists
    const files = await readdir(EXPORTS_DIR);
    const fileName = files.find(f => f.startsWith(exportId));

    if (!fileName) {
      return null;
    }

    const filePath = join(EXPORTS_DIR, fileName);
    const data = await readFile(filePath);
    return { data, fileName };
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}
