// lib/exporter.ts
import { fetchAllSpotterOData } from './spotter';
import { buildCsv, sanitizeCsvValue } from './csv';
import { v4 as uuidv4 } from 'uuid';
import { saveTemporaryFile } from './exportStorage';
import JSZip from 'jszip';

//region Type Definitions
export type LogCallback = (message: string) => void;
export type ExportMode = 'sold' | 'inProgress' | 'lost';
export type ExportableEntity = 'companies' | 'contacts' | 'deals_line_items';

// Spotter API Interfaces
interface SpotterLeadSold { id: number; leadId: number; saleDate: string; products?: SpotterProduct[] }
interface SpotterProduct { id: number; name?: string; quantity?: number; individualValue?: number; }
interface SpotterLead { id: number; lead?: string; organizationId?: number; website?: string; cnpj?: string; street?: string; number?: string; complement?: string; district?: string; cep?: string; city?: string; state?: string; country?: string; source?: { value?: string }; funnel?: { id?: number }; }
interface SpotterPerson { id: number; name?: string; leadId?: number; mainContact?: boolean; role?: string; emails?: { address?: string }[]; phones?: { number?: string }[]; social?: { platform?: string; id?: string }[]; }
//endregion

//region --- HEADERS (ABSOLUTE RULE) ---
const HEADERS = {
  COMPANIES: ['Nome da empresa', 'Nome de domínio da empresa', 'CNPJ', 'Endereço', 'Número', 'Complemento', 'Bairro', 'Código postal', 'Cidade', 'Estado/Região', 'País/Região', 'spotter_organization_id'],
  CONTACTS: ['E-mail', 'Nome', 'Sobrenome', 'Cargo', 'Telefone', 'Telefone 2', 'spotter_person_id', 'spotter_lead_id', 'spotter_main_contact', 'spotter_messaging_platform', 'spotter_messaging_id'],
  DEALS_LINE_ITEMS: ['Nome do negócio', 'Pipeline', 'Etapa do negócio', 'spotter_sale_id', 'spotter_lead_id', 'spotter_sale_date', 'spotter_sale_stage', 'spotter_cycle', 'spotter_total_deal_value', 'spotter_salesrep_email', 'spotter_presales_email', 'origem_comercial_real', 'spotter_organization_id', 'spotter_person_id', 'Nome', 'Quantidade', 'Preço unitário', 'spotter_product_id', 'spotter_discount_amount', 'spotter_discount_type', 'spotter_final_value'],
};
//endregion

//region --- UTILITY & HELPER FUNCTIONS ---
const formatDate = (iso?: string) => iso ? new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'UTC' }) : '';
const normalizeDomain = (url?: string) => {
    if (!url) return '';
    try {
        const domain = new URL(url).hostname;
        return domain.startsWith('www.') ? domain.slice(4) : domain;
    } catch { return url; }
};
const splitName = (name = '') => {
    const parts = name.trim().split(/\s+/);
    return { firstName: parts.shift() || '', lastName: parts.join(' ') || '-' };
};
//endregion

//region --- DATA FETCHING ---
const fetchLeadsSold = (token: string, baseUrl: string, log: LogCallback) => fetchAllSpotterOData<SpotterLeadSold>(`${baseUrl}/v3/LeadsSold`, token, log);
const fetchLeads = (token: string, baseUrl: string, log: LogCallback) => fetchAllSpotterOData<SpotterLead>(`${baseUrl}/v3/Leads`, token, log);
const fetchPersons = (token: string, baseUrl: string, log: LogCallback) => fetchAllSpotterOData<SpotterPerson>(`${baseUrl}/v3/Persons/`, token, log);
//endregion

//region --- CSV GENERATION (These functions now receive filtered data) ---

// A) Companies from Leads
function generateCompaniesCsv(soldLeads: SpotterLead[], log: LogCallback) {
    log(`Gerando CSV para ${soldLeads.length} empresas...`);
    const validRows: any[] = [];
    const rejectedRows: any[] = [];
    for (const lead of soldLeads) {
        let spotter_organization_id = lead.organizationId;
        if (!spotter_organization_id) {
            log(`Aviso: organizationId ausente para o lead ${lead.id}. Usando lead.id como fallback.`);
            spotter_organization_id = lead.id;
        }
        const row = {
            'Nome da empresa': lead.lead, 'Nome de domínio da empresa': normalizeDomain(lead.website), 'CNPJ': lead.cnpj,
            'Endereço': lead.street, 'Número': lead.number, 'Complemento': lead.complement, 'Bairro': lead.district,
            'Código postal': lead.cep, 'Cidade': lead.city, 'Estado/Região': lead.state, 'País/Região': lead.country,
            'spotter_organization_id': spotter_organization_id
        };
        if (!row.spotter_organization_id) {
            rejectedRows.push({ ...row, rejection_reason: 'missing_spotter_organization_id' });
        } else {
            validRows.push(row);
        }
    }
    const validCsv = buildCsv(HEADERS.COMPANIES, validRows.map(row => HEADERS.COMPANIES.map(h => sanitizeCsvValue(row[h]))));
    const rejectedCsv = rejectedRows.length ? buildCsv([...HEADERS.COMPANIES, 'rejection_reason'], rejectedRows.map(row => [...HEADERS.COMPANIES, 'rejection_reason'].map(h => sanitizeCsvValue(row[h])))) : '';
    return { valid: validCsv, rejected: rejectedCsv, counts: { exported: validRows.length, rejected: rejectedRows.length } };
}

// B) Contacts
function generateContactsCsv(soldPersons: SpotterPerson[], log: LogCallback) {
    log(`Gerando CSV para ${soldPersons.length} contatos...`);
    const validRows: any[] = [];
    const rejectedRows: any[] = [];
    for (const person of soldPersons) {
        const { firstName, lastName } = splitName(person.name);
        const row = {
            'E-mail': person.emails?.[0]?.address, 'Nome': firstName, 'Sobrenome': lastName, 'Cargo': person.role,
            'Telefone': person.phones?.[0]?.number, 'Telefone 2': person.phones?.[1]?.number,
            'spotter_person_id': person.id, 'spotter_lead_id': person.leadId, 'spotter_main_contact': person.mainContact,
            'spotter_messaging_platform': person.social?.[0]?.platform, 'spotter_messaging_id': person.social?.[0]?.id,
        };
        if (!row.spotter_person_id || !row.spotter_lead_id) {
            rejectedRows.push({ ...row, rejection_reason: 'missing_person_or_lead_id' });
        } else {
            validRows.push(row);
        }
    }
    const validCsv = buildCsv(HEADERS.CONTACTS, validRows.map(row => HEADERS.CONTACTS.map(h => sanitizeCsvValue(row[h]))));
    const rejectedCsv = rejectedRows.length ? buildCsv([...HEADERS.CONTACTS, 'rejection_reason'], rejectedRows.map(row => [...HEADERS.CONTACTS, 'rejection_reason'].map(h => sanitizeCsvValue(row[h])))) : '';
    return { valid: validCsv, rejected: rejectedCsv, counts: { exported: validRows.length, rejected: rejectedRows.length } };
}

// C) Deals + Line Items
function generateDealsLineItemsCsv(sales: SpotterLeadSold[], leadsMap: Map<number, SpotterLead>, personsMap: Map<number, SpotterPerson[]>, log: LogCallback) {
    log(`Gerando CSV para ${sales.length} negócios...`);
    const validRows: any[] = [];
    const rejectedRows: any[] = [];
    for (const sale of sales) {
        const lead = leadsMap.get(sale.leadId);
        const persons = personsMap.get(sale.leadId) ?? [];
        const mainContact = persons.find(p => p.mainContact) ?? persons.find(p => p.emails?.[0]?.address) ?? persons[0];
        (sale.products ?? [{id: 0}]).forEach(product => {
            const row = {
                'Nome do negócio': `${lead?.lead ?? 'Lead'} - ${product.name ?? 'Produto'}`,
                'Pipeline': 'default', 'Etapa do negócio': 'Vendido',
                'spotter_sale_id': sale.id, 'spotter_lead_id': sale.leadId, 'spotter_sale_date': formatDate(sale.saleDate),
                'origem_comercial_real': lead?.source?.value, 'spotter_organization_id': lead?.organizationId ?? lead?.id,
                'spotter_person_id': mainContact?.id, 'Nome': product.name, 'Quantidade': product.quantity,
                'Preço unitário': product.individualValue, 'spotter_product_id': product.id,
                'spotter_sale_stage': '', 'spotter_cycle': '', 'spotter_total_deal_value': '', 'spotter_salesrep_email': '',
                'spotter_presales_email': '', 'spotter_discount_amount': '', 'spotter_discount_type': '', 'spotter_final_value': '',
            };
            const required = [row.spotter_sale_id, row.spotter_lead_id, row.Nome, row.Quantidade, row['Preço unitário'], row.spotter_product_id];
            if (required.some(val => val === null || val === undefined)) {
                rejectedRows.push({ ...row, rejection_reason: 'missing_required_deal_fields' });
            } else {
                validRows.push(row);
            }
        });
    }
    const validCsv = buildCsv(HEADERS.DEALS_LINE_ITEMS, validRows.map(row => HEADERS.DEALS_LINE_ITEMS.map(h => sanitizeCsvValue(row[h]))));
    const rejectedCsv = rejectedRows.length ? buildCsv([...HEADERS.DEALS_LINE_ITEMS, 'rejection_reason'], rejectedRows.map(row => [...HEADERS.DEALS_LINE_ITEMS, 'rejection_reason'].map(h => sanitizeCsvValue(row[h])))) : '';
    return { valid: validCsv, rejected: rejectedCsv, counts: { exported: validRows.length, rejected: rejectedRows.length } };
}
//endregion

//region --- MAIN ORCHESTRATOR ---
export async function exportDataForMode(
  mode: ExportMode,
  entities: ExportableEntity[],
  token: string,
  baseUrl: string,
  log: LogCallback,
  funnelId?: number
): Promise<{ exportId: string }> {
    const exportId = uuidv4();
    log(`Iniciando exportação (ID: ${exportId}) no modo '${mode}'...`);

    if (mode !== 'sold') {
        throw new Error(`O modo '${mode}' ainda não está implementado.`);
    }

    // "Sold" mode implementation
    const allSales = await fetchLeadsSold(token, baseUrl, log);
    const allLeads = await fetchLeads(token, baseUrl, log);
    const leadsMap = new Map(allLeads.map(l => [l.id, l]));

    let filteredSales = allSales;
    if (funnelId) {
        log(`Total de vendas antes do filtro: ${allSales.length}. Aplicando filtro para funnelId: ${funnelId}...`);
        filteredSales = allSales.filter(sale => leadsMap.get(sale.leadId)?.funnel?.id === funnelId);
        log(`Total de vendas após filtro: ${filteredSales.length}. Removidas: ${allSales.length - filteredSales.length}.`);
    }
    const soldLeadIds = new Set(filteredSales.map(s => s.leadId));

    const files: { name: string, content: string }[] = [];

    if (entities.includes('companies')) {
        const soldLeads = allLeads.filter(lead => soldLeadIds.has(lead.id));
        const { valid, rejected, counts } = generateCompaniesCsv(soldLeads, log);
        if (valid) files.push({ name: `${exportId}_companies.csv`, content: valid });
        if (rejected) files.push({ name: `${exportId}_companies_rejected.csv`, content: rejected });
        log(`Empresas: ${counts.exported} exportadas, ${counts.rejected} rejeitadas.`);
    }
    if (entities.includes('contacts') || entities.includes('deals_line_items')) {
        const allPersons = await fetchPersons(token, baseUrl, log);
        if (entities.includes('contacts')) {
            const soldPersons = allPersons.filter(p => p.leadId && soldLeadIds.has(p.leadId));
            const { valid, rejected, counts } = generateContactsCsv(soldPersons, log);
            if (valid) files.push({ name: `${exportId}_contacts.csv`, content: valid });
            if (rejected) files.push({ name: `${exportId}_contacts_rejected.csv`, content: rejected });
            log(`Contatos: ${counts.exported} exportados, ${counts.rejected} rejeitados.`);
        }
        if (entities.includes('deals_line_items')) {
            const personsMap = new Map<number, SpotterPerson[]>();
            allPersons.forEach(p => {
                if (p.leadId && soldLeadIds.has(p.leadId)) {
                    if (!personsMap.has(p.leadId)) personsMap.set(p.leadId, []);
                    personsMap.get(p.leadId)!.push(p);
                }
            });
            const { valid, rejected, counts } = generateDealsLineItemsCsv(filteredSales, leadsMap, personsMap, log);
            if (valid) files.push({ name: `${exportId}_deals_line_items.csv`, content: valid });
            if (rejected) files.push({ name: `${exportId}_deals_line_items_rejected.csv`, content: rejected });
            log(`Negócios/Itens: ${counts.exported} exportados, ${counts.rejected} rejeitados.`);
        }
    }

    if (files.length === 0) {
        log('Nenhum arquivo válido gerado.');
        return { exportId };
    }

    let finalBuffer: Buffer;
    let finalFileName: string;
    if (files.length > 1) {
        const zip = new JSZip();
        files.forEach(f => zip.file(f.name, f.content));
        finalBuffer = await zip.generateAsync({ type: 'nodebuffer' });
        finalFileName = `${exportId}_export.zip`;
    } else {
        finalBuffer = Buffer.from(files[0].content, 'utf-8');
        finalFileName = files[0].name;
    }

    await saveTemporaryFile(finalFileName, finalBuffer);
    log(`Exportação salva em ${finalFileName}.`);

    return { exportId };
}
//endregion
