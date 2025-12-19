// app/api/download/[exportId]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getExport, isBlobStorage } from '@/lib/exportStorage';

export async function GET(
  request: NextRequest,
  { params }: { params: { exportId: string } }
) {
  const exportId = params.exportId;
  if (!exportId) {
    return new NextResponse('Export ID inválido.', { status: 400 });
  }

  // In a real Blob storage scenario, the exportId would be the full URL
  if (isBlobStorage) {
    if (URL.canParse(exportId) && new URL(exportId).hostname.endsWith('.blob.vercel-storage.com')) {
      return NextResponse.redirect(exportId);
    }
    // Fallback for safety, though it shouldn't be reached if the frontend gets the right URL
    return new NextResponse('URL de download inválida.', { status: 400 });
  }

  // Handle /tmp storage for local development
  try {
    const result = await getExport(exportId);
    if (!result) {
      return new NextResponse('Arquivo de exportação não encontrado ou expirado.', { status: 404 });
    }

    const { data, fileName } = result;
    const body = new Uint8Array(data);
    const headers = new Headers();
    const contentType = fileName.endsWith('.zip') ? 'application/zip' : 'text/csv;charset=utf-8';
    headers.set('Content-Type', contentType);
    headers.set('Content-Disposition', `attachment; filename="${fileName}"`);

    return new Response(body, { headers });

  } catch (error) {
    console.error(`Falha ao processar o download para o ID ${exportId}:`, error);
    return new NextResponse('Erro interno do servidor.', { status: 500 });
  }
}
