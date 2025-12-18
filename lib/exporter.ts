// lib/exporter.ts
import { fetchAllSpotterOData } from './spotter';
import { buildCsv, sanitizeCsvValue } from './csv';
import { v4 as uuidv4 } from 'uuid';
import JSZip from 'jszip';
import { exportStorage, isBlobStorage } from './exportStorage';

//region Type Definitions
export type LogCallback = (message: string) => void;
export type ExportMode = 'sold' | 'open' | 'lost' | 'custom';
export type ExportableEntity = 'companies' | 'contacts' | 'deals' | 'lineItems';

// Spotter API Interfaces (remains the same)
export interface SpotterLeadSold {
  leadId: number;
  saleDate: string;
  id: number;
  products?: { id: number; name?: string; quantity?: number; individualValue?: number }[];
}
export interface SpotterLead {
  id: number;
  lead?: string;
  organizationId?: number;
  source?: { value?: string };
  stage?: { value?: string };
}
export interface SpotterOrganization {
    id: number;
    name?: string;
    socialCnpj?: string;
    website?: string;
}
export interface SpotterPerson {
  id: number;
  name?: string;
  mainContact?: boolean;
  leadId?: number;
  emails?: { address?: string }[];
  phones?: { number?: string }[];
}

// Log object for run.json
interface RunLog {
  runId: string;
  mode: ExportMode;
  entities: ExportableEntity[];
  startTime: string;
  endTime?: string;
  counts: Record<string, number>;
  warnings: { message: string; data?: unknown }[];
  errors: { message: string; details: unknown }[];
  downloadRef?: string;
}
//endregion

//region Utility Functions
function formatDateBR(isoString?: string): string {
    if (!isoString) return '';
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return '';
    return `${String(date.getUTCDate()).padStart(2, '0')}/${String(date.getUTCMonth() + 1).padStart(2, '0')}/${date.getUTCFullYear()}`;
}
function mapOrigemComercialReal(sourceValue?: string): string {
    if (!sourceValue) return 'Inbound';
    const normalized = sourceValue.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    if (normalized.includes('prospeccao ativa')) return 'Outbound';
    if (normalized.includes('carteira de clientes')) return 'White Space (Base)';
    return 'Inbound';
}
function splitName(fullName: string = ''): { firstName: string; lastName: string } {
    const parts = fullName.trim().split(/\s+/);
    if (parts.length <= 1) return { firstName: parts[0] || '', lastName: '-' };
    const firstName = parts.shift() || '';
    const lastName = parts.join(' ');
    return { firstName, lastName };
}
//endregion

//region Data Fetching & Caching
const fetchLeads = (token: string, baseUrl: string, log: LogCallback) => fetchAllSpotterOData<SpotterLead>(`${baseUrl}/v3/Leads`, token, log);
const fetchLeadsSold = (token: string, baseUrl: string, log: LogCallback) => fetchAllSpotterOData<SpotterLeadSold>(`${baseUrl}/v3/LeadsSold`, token, log);
const fetchOrganizations = (token: string, baseUrl: string, log: LogCallback) => fetchAllSpotterOData<SpotterOrganization>(`${baseUrl}/v3/organization`, token, log);
const fetchPersons = (token: string, baseUrl: string, log: LogCallback) => fetchAllSpotterOData<SpotterPerson>(`${baseUrl}/v3/Persons/`, token, log);

type DataCache = {
    leads?: Map<number, SpotterLead>;
    persons?: Map<number, SpotterPerson | undefined>; // Simplified to main person
    organizations?: Map<number, SpotterOrganization>;
    leadsSold?: SpotterLeadSold[];
};
//endregion

//region Entity Exporters (Generate CSV content in memory)
function generateCompaniesCsv(cache: DataCache): string {
    const orgs = Array.from(cache.organizations?.values() ?? []);
    if (orgs.length === 0) return '';
    const rows = orgs.map(org => ({
        'ID da Empresa no Spotter': org.id,
        'Nome da Empresa': org.name || '',
        'Domínio da Empresa': org.website || '',
        'CNPJ': org.socialCnpj ? `="${org.socialCnpj}"` : '',
    }));
    const headers = Object.keys(rows[0]);
    const csvRows = rows.map(row => headers.map(header => sanitizeCsvValue((row as any)[header])));
    return buildCsv(headers, csvRows);
}

function generateContactsCsv(cache: DataCache): string {
    const persons = Array.from(cache.persons?.values() ?? []).filter(Boolean) as SpotterPerson[];
    if (persons.length === 0) return '';
    const rows = persons.map(person => {
        const { firstName, lastName } = splitName(person.name);
        return {
            'ID do Contato no Spotter': person.id,
            'Email': person.emails?.[0]?.address ?? '',
            'Nome': firstName,
            'Sobrenome': lastName,
            'Telefone': person.phones?.[0]?.number ?? '',
            'Lead ID': person.leadId ?? '',
        };
    });
    const headers = Object.keys(rows[0]);
    const csvRows = rows.map(row => headers.map(header => sanitizeCsvValue((row as any)[header])));
    return buildCsv(headers, csvRows);
}

function generateDealsAndLineItemsCsv(cache: DataCache, runLog: RunLog, exportLineItems: boolean): { dealsCsv: string, lineItemsCsv: string } {
    const dealRows: any[] = [];
    const lineItemRows: any[] = [];
    const leadsSold = cache.leadsSold ?? [];

    for (const sale of leadsSold) {
        const lead = cache.leads?.get(sale.leadId);
        if (!lead) continue;

        const person = cache.persons?.get(sale.leadId);
        if (!lead.organizationId || !person) continue;

        const primaryProductName = sale.products?.[0]?.name ?? 'Produto Principal';
        const dealName = `${lead.lead ?? `Lead ${lead.id}`} - ${primaryProductName}`;

        const baseDeal = {
            'Nome do negócio': dealName,
            'Pipeline': 'default',
            'Etapa do negócio': 'Vendido',
            'spotter_sale_id': sale.id,
            'spotter_organization_id': lead.organizationId,
            'spotter_person_id': person.id,
        };
        dealRows.push(baseDeal);

        if (exportLineItems && sale.products && sale.products.length > 0) {
            for (const product of sale.products) {
                lineItemRows.push({
                    'spotter_sale_id': sale.id, // Association Key
                    'Nome do item de linha': product.name,
                    'Quantidade': product.quantity ?? 1,
                    'Preço unitário': product.individualValue ?? 0,
                });
            }
        }
    }

    const dealsCsv = dealRows.length > 0 ? buildCsv(Object.keys(dealRows[0]), dealRows.map(row => Object.values(row).map(sanitizeCsvValue))) : '';
    const lineItemsCsv = lineItemRows.length > 0 ? buildCsv(Object.keys(lineItemRows[0]), lineItemRows.map(row => Object.values(row).map(sanitizeCsvValue))) : '';

    runLog.counts.exportedDeals = dealRows.length;
    runLog.counts.exportedLineItems = lineItemRows.length;

    return { dealsCsv, lineItemsCsv };
}
//endregion

//region Main Orchestrator
export async function exportDataForMode(
  mode: ExportMode,
  entities: ExportableEntity[],
  token: string,
  baseUrl: string,
  log: LogCallback
): Promise<{ exportId: string, downloadRef: string }> {
    const runId = uuidv4();
    const runLog: RunLog = { runId, mode, entities, startTime: new Date().toISOString(), counts: {}, warnings: [], errors: [] };
    const cache: DataCache = {};

    try {
        log(`Execução ID: ${runId}. Usando ${isBlobStorage ? 'Vercel Blob' : '/tmp'}.`);

        // --- Data Fetching ---
        if (entities.includes('companies')) {
            const orgs = await fetchOrganizations(token, baseUrl, log);
            cache.organizations = new Map(orgs.map(o => [o.id, o]));
            runLog.counts.fetchedOrganizations = orgs.length;
        }
        if (entities.includes('contacts') || entities.includes('deals') || entities.includes('lineItems')) {
            const persons = await fetchPersons(token, baseUrl, log);
            cache.persons = new Map();
            const personsByLead = new Map<number, SpotterPerson[]>();
            for (const p of persons) {
                if(p.leadId) {
                    if (!personsByLead.has(p.leadId)) personsByLead.set(p.leadId, []);
                    personsByLead.get(p.leadId)!.push(p);
                }
            }
            personsByLead.forEach((pList, leadId) => {
                cache.persons!.set(leadId, pList.find(p => p.mainContact) ?? pList[0]);
            });
            runLog.counts.fetchedPersons = persons.length;
        }
        if (entities.includes('deals') || entities.includes('lineItems')) {
             cache.leadsSold = await fetchLeadsSold(token, baseUrl, log);
             const leads = await fetchLeads(token, baseUrl, log);
             cache.leads = new Map(leads.map(l => [l.id, l]));
             runLog.counts.fetchedLeadsSold = cache.leadsSold.length;
             runLog.counts.fetchedLeads = leads.length;
        }

        // --- CSV Generation (In Memory) ---
        const generatedFiles: { name: string; content: string }[] = [];
        if (entities.includes('companies')) generatedFiles.push({ name: `${runId}_companies.csv`, content: generateCompaniesCsv(cache) });
        if (entities.includes('contacts')) generatedFiles.push({ name: `${runId}_contacts.csv`, content: generateContactsCsv(cache) });
        if (entities.includes('deals') || entities.includes('lineItems')) {
            const { dealsCsv, lineItemsCsv } = generateDealsAndLineItemsCsv(cache, runLog, entities.includes('lineItems'));
            if(dealsCsv) generatedFiles.push({ name: `${runId}_deals.csv`, content: dealsCsv });
            if(lineItemsCsv) generatedFiles.push({ name: `${runId}_line-items.csv`, content: lineItemsCsv });
        }

        const validFiles = generatedFiles.filter(f => f.content);
        if (validFiles.length === 0) throw new Error("Nenhum dado válido foi gerado para as entidades selecionadas.");

        // --- Persistence (Vercel Blob or /tmp) ---
        let finalBuffer: Buffer;
        let finalFileName: string;

        if (validFiles.length > 1) {
            log('Múltiplos arquivos gerados. Criando arquivo ZIP...');
            const zip = new JSZip();
            for (const file of validFiles) {
                zip.file(file.name, file.content);
            }
            finalBuffer = await zip.generateAsync({ type: 'nodebuffer' });
            finalFileName = `${runId}_export.zip`;
        } else {
            log('Apenas um arquivo gerado.');
            finalBuffer = Buffer.from(validFiles[0].content, 'utf-8');
            finalFileName = validFiles[0].name;
        }

        log(`Salvando ${finalFileName}...`);
        const { downloadRef } = await exportStorage.saveExport(runId, finalFileName, finalBuffer);
        runLog.downloadRef = downloadRef;

        log('Exportação concluída com sucesso.');
        return { exportId: runId, downloadRef };

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Ocorreu um erro desconhecido';
        runLog.errors.push({ message: errorMessage, details: error });
        throw error;
    } finally {
        runLog.endTime = new Date().toISOString();
        // Fire-and-forget logging
        // await writeLogFile(runId, runLog);
    }
}
//endregion
