// app/api/export/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { exportDataForMode, ExportMode, ExportableEntity } from '@/lib/exporter';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const validEntities: ExportableEntity[] = ['companies', 'contacts', 'deals_line_items'];

function toSingle(value: string | string[] | null | undefined): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (Array.isArray(value)) return value[0];
  return value;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const requestedMode = searchParams.get('mode') ?? 'total';

    // REJEITAR 'entities' (plural)
    if (searchParams.has('entities')) {
        return NextResponse.json(
            { message: 'Parâmetro "entities" não é suportado. Use "entity" (singular) para exportar um arquivo por vez.' },
            { status: 400 }
        );
    }

    // VALIDAR 'entity' (singular)
    const entityParam = searchParams.get('entity');

    if (!entityParam) {
        return NextResponse.json({ message: 'Parâmetro "entity" é obrigatório.' }, { status: 400 });
    }

    // Validar se é uma das entidades permitidas
    if (!validEntities.includes(entityParam as ExportableEntity)) {
        return NextResponse.json(
            { message: `Entidade inválida: "${entityParam}". Valores permitidos: ${validEntities.join(', ')}.` },
            { status: 400 }
        );
    }

    const entity = entityParam as ExportableEntity;

    // Force 'total' mode
    const mode: ExportMode = 'total';

    const token = process.env.SPOTTER_TOKEN_EXACT;
    const baseUrl = process.env.SPOTTER_API_URL || 'https://api.exactspotter.com';

    if (!token) {
      return NextResponse.json(
        { message: 'Erro de configuração: O token de autenticação do Spotter não está configurado.' },
        { status: 500 }
      );
    }

    const { csvContent, fileName } = await exportDataForMode(mode, entity, token, baseUrl);

    // Retornar CSV direto
    return new NextResponse(csvContent, {
        status: 200,
        headers: {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': `attachment; filename="${fileName}"`
        }
    });

  } catch (error) {
    console.error('Falha na exportação:', error);
    const errorMessage = error instanceof Error ? error.message : 'Ocorreu um erro desconhecido no servidor.';
    // Retornar JSON em caso de erro
    return NextResponse.json({ message: errorMessage }, { status: 500 });
  }
}
