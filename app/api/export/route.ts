// app/api/export/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { exportDataForMode, ExportMode, ExportableEntity } from '@/lib/exporter';

export const dynamic = 'force-dynamic';

const validEntities: ExportableEntity[] = ['companies', 'contacts', 'deals_line_items'];

function parseEntities(entitiesParam: string | null): ExportableEntity[] {
  if (!entitiesParam) {
    throw new Error('O parâmetro "entities" é obrigatório.');
  }
  const entities = entitiesParam.split(',');
  const invalidEntities = entities.filter(e => !validEntities.includes(e as ExportableEntity));

  if (invalidEntities.length > 0) {
    throw new Error(`Entidades inválidas fornecidas: ${invalidEntities.join(', ')}.`);
  }

  return entities as ExportableEntity[];
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const mode = (searchParams.get('mode') ?? 'sold') as ExportMode;
    const entities = parseEntities(searchParams.get('entities'));

    if (entities.length === 0) {
      return NextResponse.json({ message: 'Nenhuma entidade selecionada para exportação.' }, { status: 400 });
    }

    const token = process.env.SPOTTER_TOKEN_EXACT;
    const baseUrl = process.env.SPOTTER_API_URL || 'https://api.exactspotter.com';

    if (!token) {
      return NextResponse.json(
        { message: 'Erro de configuração do servidor: O token de autenticação do Spotter não está configurado.' },
        { status: 500 }
      );
    }

    const { fileContent, fileName } = await exportDataForMode(mode, entities, token, baseUrl);

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
