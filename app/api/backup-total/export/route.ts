
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

// DEFINITION: V3-relative paths (no /api/v3 prefix)
const ENTITIES: Record<string, EntityConfig> = {
  // Core
  'leads': { key: 'leads', endpoint: 'Leads', filename: 'leads.csv' },
  'companies': { key: 'companies', endpoint: 'Organization', filename: 'companies.csv' },
  'contacts': { key: 'contacts', endpoint: 'Persons', filename: 'contacts.csv' },
  'users': { key: 'users', endpoint: 'Users', filename: 'users.csv' },
  'sellers': { key: 'sellers', endpoint: 'Sellers', filename: 'sellers.csv' },
  'groups': { key: 'groups', endpoint: 'Groups', filename: 'groups.csv' },

  // Events
  'losts': { key: 'losts', endpoint: 'Losts', filename: 'lead_losts.csv' },
  'history': { key: 'history', endpoint: 'transferHistory', filename: 'lead_transfers.csv' },
  'meetings': { key: 'meetings', endpoint: 'Meetings', filename: 'meetings.csv' },

  // Dictionaries
  'funnels': { key: 'funnels', endpoint: 'funnels', filename: 'funnels.csv' },
  'stages': { key: 'stages', endpoint: 'stages', filename: 'stages.csv' },
  'sources': { key: 'sources', endpoint: 'Sources', filename: 'sources.csv' },
  'discard_reasons': { key: 'discard_reasons', endpoint: 'DiscardReason', filename: 'discard_reasons.csv' },
  'products': { key: 'products', endpoint: 'products', filename: 'products.csv' },
  'tasks_type': { key: 'tasks_type', endpoint: 'TasksType', filename: 'tasks_type.csv' },
  'custom_fields_leads': { key: 'custom_fields_leads', endpoint: 'CustomFields', filename: 'custom_fields_leads.csv' },
  'custom_fields_orgs': { key: 'custom_fields_orgs', endpoint: 'CustomFieldsOrganization', filename: 'custom_fields_companies.csv' },
};

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const entityKey = searchParams.get('entity');

  // Ping check for internal route availability
  if (entityKey === 'ping') {
    return new NextResponse('status,message\n200,OK', {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="ping.csv"',
      },
    });
  }

  if (!entityKey || !ENTITIES[entityKey]) {
    return NextResponse.json(
        { message: 'Invalid or missing entity. Available: ' + Object.keys(ENTITIES).join(', ') },
        { status: 400 }
    );
  }

  const config = ENTITIES[entityKey];
  const token = process.env.SPOTTER_TOKEN_EXACT;

  // FIXED: Default to V3 root (trailing slash important for new URL concatenation)
  const baseUrl = process.env.SPOTTER_API_URL || 'https://api.exactspotter.com/v3/';

  if (!token) {
    return NextResponse.json({ message: 'Missing SPOTTER_TOKEN_EXACT' }, { status: 500 });
  }

  // FIXED: Robust URL construction using URL class
  // We ensure baseUrl ends with / and endpoint has no leading / to prevent double slashes or replacements
  const safeBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  const safePath = config.endpoint.replace(/^\//, '');
  const finalUrl = new URL(safePath, safeBase).toString();

  // 1. Pre-flight Check: Ensure Endpoint Exists
  try {
      // Use minimal query to check availability
      const checkUrl = `${finalUrl}?$top=1`;
      const res = await fetch(checkUrl, {
          headers: {
              'token_exact': token,
              'Content-Type': 'application/json'
          }
      });

      if (!res.ok) {
          const text = await res.text();
          console.error(`[backup-total] entity ${entityKey} failed check. URL: ${finalUrl} Status: ${res.status}`);
          return NextResponse.json({
              message: `Upstream Error: ${res.status} ${res.statusText}`,
              details: text.slice(0, 300),
              finalUrl // Returned for debugging
          }, { status: res.status });
      }
  } catch (err) {
      console.error(`[backup-total] entity ${entityKey} network error`, err);
      return NextResponse.json({
          message: 'Network error connecting to Spotter API',
          error: err instanceof Error ? err.message : String(err),
          finalUrl
      }, { status: 502 });
  }

  // 2. Start Stream
  const passThrough = new PassThrough();

  (async () => {
      try {
          const generator = fetchODataPages(finalUrl, token);

          let headers: string[] | null = null;

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
          console.error(`Export stream failed for ${entityKey}:`, err);
          // If we already started writing CSV, we can't switch to JSON.
          // We append an error message to the file to invalidate it.
          passThrough.write(`\n\nERROR_DURING_STREAM: ${err instanceof Error ? err.message : String(err)}\n`);
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
