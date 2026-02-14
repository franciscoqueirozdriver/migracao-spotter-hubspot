// app/api/export/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { exportDataForMode, ExportMode, ExportableEntity } from '@/lib/exporter';
import { startRun, appendLog } from '@/lib/export/logStore';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const validEntities: ExportableEntity[] = ['companies', 'contacts', 'deals_line_items'];

export async function GET(request: NextRequest) {
  const runId = startRun();

  try {
    const { searchParams } = new URL(request.url);
    const requestedMode = searchParams.get('mode') ?? 'total';

    if (searchParams.has('entities')) {
        appendLog(runId, 'ERROR: Parameter "entities" not supported.');
        return NextResponse.json(
            { message: 'Parâmetro "entities" não é suportado. Use "entity" (singular) para exportar um arquivo por vez.' },
            { status: 400 }
        );
    }

    const entityParam = searchParams.get('entity');

    if (!entityParam) {
        appendLog(runId, 'ERROR: Missing entity parameter.');
        return NextResponse.json({ message: 'Parâmetro "entity" é obrigatório.' }, { status: 400 });
    }

    if (!validEntities.includes(entityParam as ExportableEntity)) {
        appendLog(runId, `ERROR: Invalid entity ${entityParam}.`);
        return NextResponse.json(
            { message: `Entidade inválida: "${entityParam}". Valores permitidos: ${validEntities.join(', ')}.` },
            { status: 400 }
        );
    }

    const entity = entityParam as ExportableEntity;
    const mode: ExportMode = 'total';

    const token = process.env.SPOTTER_TOKEN_EXACT;
    const baseUrl = process.env.SPOTTER_API_URL || 'https://api.exactspotter.com';

    if (!token) {
      appendLog(runId, 'FATAL: Missing SPOTTER_TOKEN_EXACT.');
      return NextResponse.json(
        { message: 'Erro de configuração: O token de autenticação do Spotter não está configurado.' },
        { status: 500 }
      );
    }

    // Pass runId to exporter
    const { csvContent, fileName } = await exportDataForMode(mode, entity, token, baseUrl, runId);

    // Return CSV with Run ID Header
    return new NextResponse(csvContent, {
        status: 200,
        headers: {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': `attachment; filename="${fileName}"`,
            'Cache-Control': 'no-store',
            'X-Export-Run-Id': runId
        }
    });

  } catch (error) {
    console.error('Falha na exportação:', error);
    const errorMessage = error instanceof Error ? error.message : 'Ocorreu um erro desconhecido no servidor.';
    appendLog(runId, `FATAL ERROR: ${errorMessage}`);
    return NextResponse.json({ message: errorMessage }, { status: 500 });
  }
}
