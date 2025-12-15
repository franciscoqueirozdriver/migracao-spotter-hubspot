import { NextResponse } from 'next/server';
import { exportProductsToCsv } from '../../../lib/spotter';

export const dynamic = 'force-dynamic';

export async function GET() {
  const token = process.env.SPOTTER_TOKEN_EXACT;
  const baseUrl = process.env.SPOTTER_BASE_URL || 'https://api.exactspotter.com';

  if (!token) {
    return NextResponse.json(
      { error: 'SPOTTER_TOKEN_EXACT environment variable is not set.' },
      { status: 500 }
    );
  }

  try {
    const csvContent = await exportProductsToCsv(token, baseUrl);

    // Create a response with the CSV content
    const response = new NextResponse(csvContent, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="products_hubspot.csv"',
      },
    });

    return response;
  } catch (error) {
    console.error('Error exporting products:', error);
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    return NextResponse.json(
      { error: 'Failed to export products.', details: errorMessage },
      { status: 500 }
    );
  }
}
