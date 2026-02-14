// lib/exporter.ts
import { generateCompaniesCsvStrict } from './exporters/companies';
import { generateContactsCsvStrict } from './exporters/contacts';
import { generateDealsItemsCsvStrict } from './exporters/deals';
import { appendLog } from './export/logStore';

export type LogCallback = (message: string) => void;
export type ExportMode = 'sold' | 'inProgress' | 'lost' | 'total';
export type ExportableEntity = 'companies' | 'contacts' | 'deals_line_items' | 'leads';

export interface ExportLog {
  startedAt: string;
  finishedAt?: string;
  entity: ExportableEntity;
  modeRequested: string;
  modeApplied: string;
  totals: {
    leadsFetched?: number;
    soldFetched?: number;
    lostFetched?: number;
    dealsGenerated?: number;
    lineItemsGenerated?: number;
    // Generic counters for other entities
    recordsFetched?: number;
    recordsGenerated?: number;
  };
  discards: {
    leadsWithoutOrg?: number;
    leadsWithoutPerson?: number;
  };
  warnings: string[];
  errors: string[];
  lines: string[];
}

//region --- Função de Exportação Principal ---
export async function exportDataForMode(
  mode: ExportMode,
  entity: ExportableEntity,
  token: string,
  baseUrl: string,
  runId: string
): Promise<{ csvContent: string, logContent: string, fileName: string }> {

  appendLog(runId, `--- Nova Execução: ${entity} [${mode}] (RunID: ${runId}) ---`);

  // Internal log object for logic compatibility (passed to exporters)
  // We sync it with the global store
  const currentLog: ExportLog = {
    startedAt: new Date().toISOString(),
    entity,
    modeRequested: mode,
    modeApplied: 'total',
    totals: {},
    discards: {},
    warnings: [],
    errors: [],
    lines: []
  };

  const log: LogCallback = (message) => {
    appendLog(runId, message);
    // Keep local structure for consistency if needed by other parts
    if (message.includes('WARNING') || message.includes('WARN_')) currentLog.warnings.push(message);
    if (message.includes('ERROR') || message.includes('FATAL')) currentLog.errors.push(message);
  };

  log(`Iniciando exportação para entidade: ${entity}`);

  let csvContent = '';
  let fileName = 'export.csv';

  try {
      if (entity === 'companies') {
          csvContent = await generateCompaniesCsvStrict(token, baseUrl, log, currentLog);
          fileName = 'empresas.csv';
      } else if (entity === 'contacts') {
          csvContent = await generateContactsCsvStrict(token, baseUrl, log, currentLog);
          fileName = 'contatos.csv';
      } else if (entity === 'deals_line_items') {
          csvContent = await generateDealsItemsCsvStrict(token, baseUrl, log, currentLog);
          fileName = 'negocios_itens.csv';
      } else {
           throw new Error(`Entidade desconhecida ou não suportada: ${entity}`);
      }

      currentLog.finishedAt = new Date().toISOString();
      log('Exportação concluída com sucesso.');

  } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      log(`ERRO FATAL: ${errorMsg}`);
      currentLog.errors.push(errorMsg);
      currentLog.finishedAt = new Date().toISOString();
      throw err;
  }

  // Return empty string for legacy logContent as it is now handled via runId/API
  return { csvContent, logContent: '', fileName };
}
//endregion
