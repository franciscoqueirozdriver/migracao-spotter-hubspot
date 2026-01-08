// app/api/export/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { exportDataForMode, ExportMode, ExportableEntity } from '@/lib/exporter';

export const dynamic = 'force-dynamic';
// Try to increase duration on supported plans (Pro/Enterprise).
// Standard is 10s (Hobby) or 60s (Pro).
// Setting higher just in case, but code-level timeout is the real safety net.
export const maxDuration = 300;

const validEntities: ExportableEntity[] = ['companies', 'contacts', 'deals_line_items', 'leads'];

function normalizeEntities(input: unknown): string[] {
  // Aceita: string, string[], ou qualquer coisa (valida)
  const arr: unknown[] =
    Array.isArray(input) ? input :
    typeof input === "string" ? [input] :
    input == null ? [] :
    [input];

  // Achata "a,b,c" e remove lixo
  return arr
    .flatMap((v) => {
      if (typeof v !== "string") return [];
      return v.split(","); // permite entities=a,b,c
    })
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const requestedMode = searchParams.get('mode') ?? 'sold';

    // OVERRIDE: Force 'total' mode regardless of what frontend requests (unless it's custom in future).
    // The user explicitly requested to "forget sold" and prioritize total full export.
    // We treat 'sold' from UI as an intent to export data, but we fulfill it with the robust 'total' strategy.
    let mode: ExportMode = 'total';

    // ROBUST PARAMETER PARSING
    const rawEntities = searchParams.getAll('entities');
    const entitiesStrings = normalizeEntities(rawEntities);

    // 1. Check if empty
    if (entitiesStrings.length === 0) {
        return NextResponse.json({ message: 'Parâmetro "entities" ausente ou inválido.' }, { status: 400 });
    }

    // 2. Validate against allowed values
    const invalidEntities = entitiesStrings.filter(e => !validEntities.includes(e as ExportableEntity));
    if (invalidEntities.length > 0) {
        return NextResponse.json({ message: `Entidades inválidas fornecidas: ${invalidEntities.join(', ')}.` }, { status: 400 });
    }

    const entities = entitiesStrings as ExportableEntity[];

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

    // Append a notice to logs about the mode override if applicable
    const finalLogContent = requestedMode !== 'total'
        ? `[SYSTEM] Modo solicitado '${requestedMode}' foi automaticamente convertido para 'total' para garantir exportação completa.\n${logContent}`
        : logContent;

    // Retorna a resposta como JSON para o frontend
    return NextResponse.json({
      csvContent,
      logContent: finalLogContent,
      fileName
    });

  } catch (error) {
    console.error('Falha na exportação:', error);
    const errorMessage = error instanceof Error ? error.message : 'Ocorreu um erro desconhecido no servidor.';
    // Retornamos 500, mas o erro será JSON válido agora, ao contrário do timeout do Vercel
    return NextResponse.json({ message: errorMessage }, { status: 500 });
  }
}
