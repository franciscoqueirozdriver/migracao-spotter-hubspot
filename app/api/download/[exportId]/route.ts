// app/api/download/[exportId]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { join } from 'path';
import { readdir, readFile } from 'fs/promises';
import { statSync } from 'fs';
import JSZip from 'jszip';

export async function GET(
  request: NextRequest,
  { params }: { params: { exportId: string } }
) {
  const exportId = params.exportId;
  if (!exportId) {
    return new NextResponse('Export ID inválido.', { status: 400 });
  }

  try {
    const exportsDir = join(process.cwd(), 'exports');
    const allFiles = await readdir(exportsDir);

    // Find all files related to this export run (excluding logs)
    const exportFiles = allFiles.filter(
      file => file.startsWith(exportId) && (file.endsWith('.csv'))
    );

    if (exportFiles.length === 0) {
      return new NextResponse('Nenhum arquivo de exportação encontrado para este ID.', { status: 404 });
    }

    // If there's only one CSV, send it directly
    if (exportFiles.length === 1) {
      const filePath = join(exportsDir, exportFiles[0]);
      const fileBuffer = await readFile(filePath);
      const headers = new Headers();
      headers.set('Content-Type', 'text/csv;charset=utf-8');
      headers.set('Content-Disposition', `attachment; filename="${exportFiles[0]}"`);
      return new NextResponse(fileBuffer, { headers });
    }

    // If there are multiple CSVs, create a ZIP file
    const zip = new JSZip();
    for (const file of exportFiles) {
      const filePath = join(exportsDir, file);
      const fileBuffer = await readFile(filePath);
      zip.file(file, fileBuffer);
    }

    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });
    const headers = new Headers();
    headers.set('Content-Type', 'application/zip');
    headers.set('Content-Disposition', `attachment; filename="${exportId}_export.zip"`);

    return new NextResponse(zipBuffer, { headers });

  } catch (error) {
    console.error(`Falha ao processar o download para o ID ${exportId}:`, error);
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
         return new NextResponse('Diretório de exportações não encontrado.', { status: 404 });
    }
    return new NextResponse('Erro interno do servidor.', { status: 500 });
  }
}
