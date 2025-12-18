// app/api/download/[exportId]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { exportStorage, isBlobStorage } from '@/lib/exportStorage';

export async function GET(
  request: NextRequest,
  { params }: { params: { exportId: string } }
) {
  const exportId = params.exportId;
  if (!exportId) {
    return new NextResponse('Export ID inválido.', { status: 400 });
  }

  try {
    // If using Vercel Blob, the exportId is the full URL, so we can redirect.
    if (isBlobStorage) {
      // The `exportId` in this context is the blob's public URL passed from the exporter.
      // We perform a simple validation to ensure it's a vercel-blob URL.
      if (URL.canParse(exportId) && new URL(exportId).hostname.endsWith('.blob.vercel-storage.com')) {
         return NextResponse.redirect(exportId);
      } else {
         return new NextResponse('URL de download inválida.', { status: 400 });
      }
    }

    // If using /tmp storage, fetch the file from the filesystem.
    const result = await exportStorage.getExport(exportId);

    if (!result) {
      return new NextResponse('Arquivo de exportação não encontrado ou expirado.', { status: 404 });
    }

    const { data, fileName } = result;

    // Convert Buffer to Uint8Array to be compatible with NextResponse
    const body = new Uint8Array(data);

    const headers = new Headers();
    const contentType = fileName.endsWith('.zip') ? 'application/zip' : 'text/csv;charset=utf-8';
    headers.set('Content-Type', contentType);
    headers.set('Content-Disposition', `attachment; filename="${fileName}"`);

    return new NextResponse(body, { headers });

  } catch (error) {
    console.error(`Falha ao processar o download para o ID ${exportId}:`, error);
    return new NextResponse('Erro interno do servidor.', { status: 500 });
  }
}
