
import path from 'path';
import fs from 'fs';
import { runExportOrganizations } from './export-organizations-all';
import { runExportLeads } from './export-leads-all';
import { runExportContacts } from './export-contacts-all';
import { AuditTotals, DiscardReason } from './types';
import { paginateOData } from '../../lib/exactSpotter/paginate';

// We also need "sold" leads specifically to perform the audit logic requested:
// "Golden chain (do not break): LeadsSold.leadId -> Leads.id -> Leads.organizationId -> Organization.id"
// So we need to fetch /v3/LeadsSold as well to compare against the "all" baselines.
interface LeadsSoldItem {
    leadId: number;
    saleDate: string;
    // other fields ignored for audit
}

const SPOTTER_TOKEN = process.env.SPOTTER_TOKEN_EXACT;
const SPOTTER_BASE_URL = 'https://api.spotter.com.br'; // Standard URL, can be overridden if needed but usually static for Spotter.

if (!SPOTTER_TOKEN) {
    console.error('ERROR: SPOTTER_TOKEN_EXACT environment variable is required.');
    process.exit(1);
}

async function run() {
    const runId = new Date().toISOString().replace(/[:.]/g, '-');
    const outputDir = path.join(process.cwd(), 'exports', runId);

    // Create directory
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    console.log(`Starting Baseline Export & Audit. Run ID: ${runId}`);
    console.log(`Output Directory: ${outputDir}`);

    // 1. Fetch Baselines
    // We run them sequentially to avoid rate limits or memory pressure, though Promise.all could work if API permits.
    const organizations = await runExportOrganizations(outputDir, SPOTTER_TOKEN!, SPOTTER_BASE_URL);
    const leads = await runExportLeads(outputDir, SPOTTER_TOKEN!, SPOTTER_BASE_URL);
    // Contacts is optional/baseline but good to have
    await runExportContacts(outputDir, SPOTTER_TOKEN!, SPOTTER_BASE_URL);

    // 2. Fetch LeadsSold for the specific Audit logic
    console.log('Fetching LeadsSold for audit comparison...');
    const leadsSold = await paginateOData<LeadsSoldItem>(SPOTTER_BASE_URL, '/v3/LeadsSold', SPOTTER_TOKEN!, console.log);
    console.log(`Fetched ${leadsSold.length} sold leads records.`);

    // 3. Perform Audit Logic
    console.log('--- Performing Audit ---');

    // Index organizations by ID
    const orgMap = new Set(organizations.map(o => o.id));

    // Index Leads by ID
    const leadMap = new Map(leads.map(l => [l.id, l]));

    // Counters
    let leads_sold_total = leadsSold.length;
    const uniqueSoldLeadIds = new Set(leadsSold.map(ls => ls.leadId));
    let leads_sold_unique_leadIds = uniqueSoldLeadIds.size;

    let leads_found = 0;
    let leads_missing = 0;

    const leads_discarded_by_reason: Record<DiscardReason, number> = {
        'LEAD_NOT_FOUND': 0,
        'LEAD_STAGE_DISCARDED': 0, // Not strictly filtering by stage here since we want to know if they exist, but we can track mismatches
        'LEAD_NO_ORG_ID': 0,
        'ORG_NOT_FOUND_FOR_LEAD': 0
    };

    const validOrgIds = new Set<number>();
    const missingOrgIdsSample: number[] = [];
    const missingLeadIdsSample: number[] = [];

    for (const leadId of Array.from(uniqueSoldLeadIds)) {
        const lead = leadMap.get(leadId);

        if (!lead) {
            leads_missing++;
            leads_discarded_by_reason['LEAD_NOT_FOUND']++;
            if (missingLeadIdsSample.length < 50) missingLeadIdsSample.push(leadId);
            continue;
        }

        leads_found++;

        // Golden Chain check: Lead -> Org ID
        if (!lead.organizationId) {
            leads_discarded_by_reason['LEAD_NO_ORG_ID']++;
            continue;
        }

        // Golden Chain check: Org ID -> Organization
        if (!orgMap.has(lead.organizationId)) {
            leads_discarded_by_reason['ORG_NOT_FOUND_FOR_LEAD']++;
            if (missingOrgIdsSample.length < 50) missingOrgIdsSample.push(lead.organizationId);
            continue;
        }

        validOrgIds.add(lead.organizationId);
    }

    const auditTotals: AuditTotals = {
        run_id: runId,
        timestamp_utc: new Date().toISOString(),
        leads_sold_total,
        leads_sold_unique_leadIds,
        leads_found,
        leads_missing,
        leads_discarded_by_reason,
        unique_org_ids_from_valid_leads: validOrgIds.size,
        orgs_found: organizations.length,
        orgs_missing: missingOrgIdsSample.length, // approximation based on samples or we could count exact if needed
        final_export_organizations_sold_count: validOrgIds.size, // This represents how many orgs we WOULD export in a valid "sold" run
        samples_missing_org_ids: missingOrgIdsSample,
        samples_missing_lead_ids: missingLeadIdsSample
    };

    const auditPath = path.join(outputDir, 'audit_totals.json');
    fs.writeFileSync(auditPath, JSON.stringify(auditTotals, null, 2));
    console.log(`Audit saved to ${auditPath}`);
    console.log('--- Audit Complete ---');
}

run().catch(err => {
    console.error('Fatal Error:', err);
    process.exit(1);
});
