// app/api/export/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { exportDataForMode, ExportMode } from '@/lib/exporter';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const mode = (searchParams.get('mode') ?? 'sold') as ExportMode;

    const token = process.env.SPOTTER_TOKEN_EXACT;
    const baseUrl = process.env.SPOTTER_API_URL || 'https://api.exactspotter.com';

    if (!token) {
      return NextResponse.json(
        { message: 'Erro de configuração do servidor: O token de autenticação do Spotter não está configurado.' },
        { status: 500 }
      );
    }

    const { fileContent, fileName } = await exportDataForMode(mode, token, baseUrl);

    // Cast to 'any' to resolve TypeScript type mismatch between Node.js Buffer and standard Response body
    return new Response(fileContent as any, {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${fileName}"`,
      },
    });

  } catch (error) {
    console.error('Falha na exportação:', error);
    const errorMessage = error instanceof Error ? error.message : 'Ocorreu um erro desconhecido no servidor.';
    return NextResponse.json({ message: errorMessage }, { status: 500 });
  }
}
