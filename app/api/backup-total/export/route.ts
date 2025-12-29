
import { NextRequest, NextResponse } from 'next/server';
import { PassThrough } from 'stream';
import { fetchODataPages } from '@/lib/spotter-stream';
import { safeCsvField } from '@/lib/csv/secure-writer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5 minutes

interface EntityConfig {
  key: string;
  endpoint: string;
  filename: string;
}

const ENTITIES: Record<string, EntityConfig> = {
  // Core
  'leads': { key: 'leads', endpoint: '/api/v3/Leads', filename: 'leads.csv' },
  'companies': { key: 'companies', endpoint: '/api/v3/Organization', filename: 'companies.csv' },
  'contacts': { key: 'contacts', endpoint: '/api/v3/Persons', filename: 'contacts.csv' },
  'users': { key: 'users', endpoint: '/api/v3/Users', filename: 'users.csv' },
  'sellers': { key: 'sellers', endpoint: '/api/v3/Sellers', filename: 'sellers.csv' },
  'groups': { key: 'groups', endpoint: '/api/v3/Groups', filename: 'groups.csv' },

  // Events
  'losts': { key: 'losts', endpoint: '/api/v3/Losts', filename: 'lead_losts.csv' },
  'history': { key: 'history', endpoint: '/api/v3/transferHistory', filename: 'lead_transfers.csv' },
  'meetings': { key: 'meetings', endpoint: '/api/v3/Meetings', filename: 'meetings.csv' },

  // Dictionaries
  'funnels': { key: 'funnels', endpoint: '/api/v3/funnels', filename: 'funnels.csv' },
  'stages': { key: 'stages', endpoint: '/api/v3/stages', filename: 'stages.csv' },
  'sources': { key: 'sources', endpoint: '/api/v3/Sources', filename: 'sources.csv' },
  'discard_reasons': { key: 'discard_reasons', endpoint: '/api/v3/DiscardReason', filename: 'discard_reasons.csv' },
  'products': { key: 'products', endpoint: '/api/v3/products', filename: 'products.csv' },
  'tasks_type': { key: 'tasks_type', endpoint: '/api/v3/TasksType', filename: 'tasks_type.csv' },
  'custom_fields_leads': { key: 'custom_fields_leads', endpoint: '/api/v3/CustomFields', filename: 'custom_fields_leads.csv' },
  'custom_fields_orgs': { key: 'custom_fields_orgs', endpoint: '/api/v3/CustomFieldsOrganization', filename: 'custom_fields_companies.csv' },
};

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const entityKey = searchParams.get('entity');

  if (!entityKey || !ENTITIES[entityKey]) {
    return NextResponse.json(
        { message: 'Invalid or missing entity. Available: ' + Object.keys(ENTITIES).join(', ') },
        { status: 400 }
    );
  }

  const config = ENTITIES[entityKey];
  const token = process.env.SPOTTER_TOKEN_EXACT;
  const baseUrl = process.env.SPOTTER_API_URL || 'https://api.exactspotter.com';

  if (!token) {
    return NextResponse.json({ message: 'Missing SPOTTER_TOKEN_EXACT' }, { status: 500 });
  }

  const passThrough = new PassThrough();

  // Async process to drive the stream
  (async () => {
      try {
          const fullUrl = `${baseUrl}${config.endpoint}`;
          // console.log(`Starting export for ${entityKey} from ${fullUrl}`);

          const generator = fetchODataPages(fullUrl, token);

          let headers: string[] | null = null;
          let isFirst = true;

          for await (const page of generator) {
              if (!page.items || page.items.length === 0) continue;
              const items = page.items as Record<string, unknown>[];

              if (!headers) {
                  headers = Object.keys(items[0]);
                  passThrough.write('\ufeff'); // BOM
                  passThrough.write(headers.map(h => safeCsvField(h)).join(',') + '\n');
              }

              for (const item of items) {
                  const row = headers.map(k => safeCsvField(item[k]));
                  passThrough.write(row.join(',') + '\n');
              }
          }

      } catch (err) {
          console.error(`Export failed for ${entityKey}:`, err);
          passThrough.write(`\nERROR: ${err instanceof Error ? err.message : String(err)}\n`);
      } finally {
          passThrough.end();
      }
  })();

  return new NextResponse(passThrough as any, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${config.filename}"`,
    },
  });
}
