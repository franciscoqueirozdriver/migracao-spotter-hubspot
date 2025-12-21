// app/api/export/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { exportDataForMode, ExportMode, ExportableEntity } from '@/lib/exporter';

export const dynamic = 'force-dynamic';
// Try to increase duration on supported plans (Pro/Enterprise).
// Standard is 10s (Hobby) or 60s (Pro).
// Setting higher just in case, but code-level timeout is the real safety net.
export const maxDuration = 300;

const validEntities: ExportableEntity[] = ['companies', 'contacts', 'deals_line_items', 'leads'];

function parseEntities(entitiesParam: string | null): ExportableEntity[] {
  if (!entitiesParam) {
    // Se nenhum parâmetro for fornecido, podemos assumir um padrão ou lançar um erro.
    // Para este caso, vamos assumir que o usuário deve sempre fornecer as entidades.
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
    // Handle case where entities param might be missing or empty strings
    const entitiesParam = searchParams.get('entities');
    const entities = parseEntities(entitiesParam);

    if (entities.length === 0) {
      return NextResponse.json({ message: 'Nenhuma entidade selecionada para exportação.' }, { status: 400 });
    }

    const token = process.env.SPOTTER_TOKEN_EXACT;
    const baseUrl = process.env.SPOTTER_API_URL || 'https://api.exactspotter.com';

    if (!token) {
      return NextResponse.json(
        { message: 'Erro de configuração: O token de autenticação do Spotter não está configurado.' },
        { status: 500 }
      );
    }

    // A função agora retorna um objeto com o conteúdo do CSV e os logs
    const { csvContent, logContent, fileName } = await exportDataForMode(mode, entities, token, baseUrl);

    // Retorna a resposta como JSON para o frontend
    return NextResponse.json({
      csvContent,
      logContent,
      fileName
    });

  } catch (error) {
    console.error('Falha na exportação:', error);
    const errorMessage = error instanceof Error ? error.message : 'Ocorreu um erro desconhecido no servidor.';
    // Retornamos 500, mas o erro será JSON válido agora, ao contrário do timeout do Vercel
    return NextResponse.json({ message: errorMessage }, { status: 500 });
  }
}
