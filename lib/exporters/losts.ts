
import { paginateOData } from '../exactSpotter/paginate';
import { generateCsv, sanitizeCsvValue } from '../csv/writer';
import { LogCallback, ExportLog } from '../exporter';

// Safe normalization helper (same as deals.ts to keep consistency)
function toLowerText(input: unknown): string {
    if (typeof input === "string") return input.toLowerCase();
    if (input instanceof Error) return (input.message ?? "").toLowerCase();
    try { return String(input ?? "").toLowerCase(); } catch { return ""; }
}

export async function generateLostsCsv(token: string, baseUrl: string, log: LogCallback, currentLog: ExportLog): Promise<string> {
    log('--- Starting Losts Export (losts.csv) ---');

    // 1. Fetch Losts (Generic Record)
    // We treat items as generic records because we need dynamic columns
    log('Fetching Losts...');
    const losts = await paginateOData<Record<string, unknown>>(baseUrl, '/v3/Losts', token, log);
    currentLog.totals.recordsFetched = losts.length;
    log(`Fetched ${losts.length} lost records.`);

    if (losts.length === 0) {
        log('No lost records found. Generating empty CSV.');
        return '\ufeff' + generateCsv(['leadId', 'stage', 'funnelId', 'reason', 'date'], []);
    }

    // 2. Determine Dynamic Headers
    const keysSet = new Set<string>();
    for (const item of losts) {
        Object.keys(item).forEach(k => keysSet.add(k));
    }

    const allKeys = Array.from(keysSet);
    const preferredKeys = ['leadId', 'stage', 'funnelId', 'reason', 'date'];

    // Sort keys: preferred first, then alphabetical for the rest
    const otherKeys = allKeys.filter(k => !preferredKeys.includes(k)).sort();

    // Final headers list (filter strictly to keys that actually exist in the data to avoid empty columns if preferred keys are missing,
    // BUT usually we want preferred keys even if empty. The requirement says "priorize chaves comuns... e depois o restante".
    // Let's keep preferred keys even if not present, for consistency, or strictly intersection?
    // "header final é a união ordenada das chaves" implies only keys present in data.
    // However, usually "leadId" etc are always present. Let's use intersection with preferred + others.

    const presentPreferred = preferredKeys.filter(k => keysSet.has(k));
    const finalHeaders = [...presentPreferred, ...otherKeys];

    log(`Total columns identified: ${finalHeaders.length}`);

    // 3. Generate Rows
    // We need to map each item to an object with keys matching finalHeaders, but stringified.
    // generateCsv expects Record<string, unknown>.

    const rows = losts.map(item => {
        const row: Record<string, unknown> = {};
        for (const key of finalHeaders) {
            const val = item[key];
            let safeVal = '';

            if (val === null || val === undefined) {
                safeVal = '';
            } else if (typeof val === 'object') {
                try {
                    safeVal = JSON.stringify(val);
                } catch {
                    safeVal = '[Object]';
                }
            } else {
                safeVal = String(val);
            }
            row[key] = safeVal;
        }
        return row;
    });

    currentLog.totals.recordsGenerated = rows.length;

    // 4. Build CSV
    const csvContent = generateCsv(finalHeaders, rows);
    return '\ufeff' + csvContent;
}
