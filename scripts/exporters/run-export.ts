
import path from 'path';
import fs from 'fs';
import { runExportCompanies } from './export-companies';
import { runExportContacts } from './export-contacts';
import { runExportDealsAndItems } from './export-deals-items';

const SPOTTER_TOKEN = process.env.SPOTTER_TOKEN_EXACT;
const SPOTTER_BASE_URL = 'https://api.spotter.com.br';

if (!SPOTTER_TOKEN) {
    console.error('ERROR: SPOTTER_TOKEN_EXACT environment variable is required.');
    process.exit(1);
}

// Parse args
const args = process.argv.slice(2);
const baseArg = args.find(a => a.startsWith('--base='));
const base = baseArg ? baseArg.split('=')[1] : null;

if (!base || !['empresas', 'contatos', 'negocios_itens'].includes(base)) {
    console.error('Usage: tsx scripts/exporters/run-export.ts --base=[empresas|contatos|negocios_itens]');
    process.exit(1);
}

async function run() {
    const runId = new Date().toISOString().replace(/[:.]/g, '-');
    const outputDir = path.join(process.cwd(), 'exports', runId);

    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    console.log(`Starting Export. Base: ${base}`);
    console.log(`Output Directory: ${outputDir}`);

    try {
        switch (base) {
            case 'empresas':
                await runExportCompanies(outputDir, SPOTTER_TOKEN!, SPOTTER_BASE_URL);
                break;
            case 'contatos':
                await runExportContacts(outputDir, SPOTTER_TOKEN!, SPOTTER_BASE_URL);
                break;
            case 'negocios_itens':
                await runExportDealsAndItems(outputDir, SPOTTER_TOKEN!, SPOTTER_BASE_URL);
                break;
        }
        console.log('--- Export Complete ---');
    } catch (err) {
        console.error('Export failed:', err);
        process.exit(1);
    }
}

run();
