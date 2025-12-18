// app/api/download/[exportId]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getExport } from '@/lib/exportStorage';

export async function GET(
  request: NextRequest,
  { params }: { params: { exportId: string } }
) {
  const exportId = params.exportId;
  if (!exportId) {
    return new NextResponse('Export ID inválido.', { status: 400 });
  }

  try {
    const result = await getExport(exportId);

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
