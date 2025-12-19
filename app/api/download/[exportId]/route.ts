// app/api/download/[exportId]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getTmpExport } from '@/lib/exportStorage';

const isProduction = process.env.VERCEL === '1' || process.env.NODE_ENV === 'production';

export async function GET(
  request: NextRequest,
  { params }: { params: { exportId: string } }
) {
  const exportId = params.exportId;
  if (!exportId) {
    return new NextResponse('Referência de download inválida.', { status: 400 });
  }

  // In production, the exportId is expected to be a full, encoded URL to a Vercel Blob.
  if (isProduction) {
    const decodedUrl = decodeURIComponent(exportId);
    if (URL.canParse(decodedUrl) && new URL(decodedUrl).hostname.endsWith('.blob.vercel-storage.com')) {
      return NextResponse.redirect(decodedUrl);
    }
    return new NextResponse('URL de download inválida ou malformada.', { status: 400 });
  }

  // In local development, the exportId is a UUID used to find a file in /tmp.
  try {
    const result = await getTmpExport(exportId);
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
