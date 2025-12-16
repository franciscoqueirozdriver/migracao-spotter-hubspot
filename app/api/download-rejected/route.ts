// app/api/download-rejected/route.ts
import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { buildCsv, sanitizeCsvValue } from '../../../lib/csv';
import { HubSpotRejectedContactRow, CONTACT_HEADERS } from '../../../lib/contacts';

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id');

  if (!id) {
    return new NextResponse(JSON.stringify({ message: 'ID de exportação ausente.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const tempFilePath = path.join('/tmp', 'exports', `rejected-${id}.json`);

  try {
    if (!fs.existsSync(tempFilePath)) {
      return new NextResponse(JSON.stringify({ message: 'Arquivo de exportação não encontrado ou expirado.' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const jsonData = fs.readFileSync(tempFilePath, 'utf-8');
    const rejectedRows: HubSpotRejectedContactRow[] = JSON.parse(jsonData);

    const rejectedHeaders: (keyof HubSpotRejectedContactRow)[] = [
      ...CONTACT_HEADERS,
      'reject_reason',
      'reject_detail',
    ];

    const csvRows = rejectedRows.map(row =>
      rejectedHeaders.map(header => sanitizeCsvValue(row[header]))
    );

    const csvContent = buildCsv(rejectedHeaders, csvRows);

    // Clean up the temporary file
    fs.unlinkSync(tempFilePath);

    return new NextResponse(csvContent, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv;charset=utf-8;',
        'Content-Disposition': `attachment; filename="spotter_to_hubspot_contatos__rejeitados_normalizar.csv"`,
      },
    });

  } catch (error) {
    console.error('Falha ao gerar CSV de rejeitados:', error);
    // Attempt to clean up even if there's an error
    if (fs.existsSync(tempFilePath)) {
      fs.unlinkSync(tempFilePath);
    }
    return new NextResponse(JSON.stringify({ message: 'Erro interno do servidor ao gerar o arquivo CSV.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
