// lib/exportStorage.ts
import { put, head, del } from '@vercel/blob';
import { join } from 'path';
import { writeFile, readFile, mkdir, readdir } from 'fs/promises';

const useVercelBlob = !!process.env.BLOB_READ_WRITE_TOKEN;

// Interface for the functions
interface ExportStorage {
  saveExport: (exportId: string, fileName: string, data: Buffer) => Promise<{ downloadRef: string }>;
  getExport: (downloadRef: string) => Promise<{ data: Buffer; fileName: string } | null>;
}

// --- Vercel Blob Implementation ---
const blobStorage: ExportStorage = {
  async saveExport(exportId, fileName, data) {
    const blobResult = await put(fileName, data, {
      access: 'public',
      addRandomSuffix: false, // Use the exact filename
    });
    // The downloadRef will be the URL of the blob
    return { downloadRef: blobResult.url };
  },
  async getExport(downloadRef) {
    // In this implementation, the downloadRef is the public URL,
    // so the download route will just redirect to it.
    // This function is kept for interface consistency but won't be directly called
    // by the download route when using Vercel Blob with public access.
    // A real implementation might fetch the blob if it were private.
    return null;
  }
};

// --- Filesystem (/tmp) Implementation ---
const tmpStorage: ExportStorage = {
  async saveExport(exportId, fileName, data) {
    const dir = join('/tmp', 'exports');
    await mkdir(dir, { recursive: true });
    const filePath = join(dir, fileName);
    await writeFile(filePath, data);
    // The downloadRef is just the exportId, which will be used to find the file
    return { downloadRef: exportId };
  },
  async getExport(downloadRef) {
    const dir = join('/tmp', 'exports');
    const files = await readdir(dir);
    // Find the file associated with this export ID
    const fileName = files.find(f => f.startsWith(downloadRef));
    if (!fileName) {
      return null;
    }
    const filePath = join(dir, fileName);
    const data = await readFile(filePath);
    return { data, fileName };
  }
};

export const exportStorage: ExportStorage = useVercelBlob ? blobStorage : tmpStorage;

export const isBlobStorage = useVercelBlob;
