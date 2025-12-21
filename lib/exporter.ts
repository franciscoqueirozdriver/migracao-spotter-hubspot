// lib/exporter.ts
import { generateCompaniesCsvStrict } from './exporters/companies';
import { generateContactsCsvStrict } from './exporters/contacts';
import { generateDealsItemsCsvStrict } from './exporters/deals';

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
}

// Global variable to store the last log (in-memory)
let lastExportLog: ExportLog | null = null;

export function getLastLog(): ExportLog | null {
  return lastExportLog;
}

//region --- Função de Exportação Principal ---
export async function exportDataForMode(
  mode: ExportMode,
  entity: ExportableEntity,
  token: string,
  baseUrl: string
): Promise<{ csvContent: string, logContent: string, fileName: string }> {

  // Initialize the log object
  const currentLog: ExportLog = {
    startedAt: new Date().toISOString(),
    entity,
    modeRequested: mode,
    modeApplied: 'total', // We force 'total' as per requirements
    totals: {},
    discards: {},
    warnings: [],
    errors: []
  };

  // Helper to append messages to warnings/errors and also keep a string buffer for legacy reasons if needed
  const logMessages: string[] = [];
  const log: LogCallback = (message) => {
    const msg = `[${new Date().toISOString()}] ${message}`;
    logMessages.push(msg);
    console.log(msg); // Ensure it logs to backend console

    // Simple heuristic to classify warnings/errors from string messages if needed,
    // though ideally we push directly to arrays.
    if (message.includes('WARNING')) currentLog.warnings.push(message);
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
      lastExportLog = currentLog; // Update global log on success

  } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      log(`ERRO FATAL: ${errorMsg}`);
      currentLog.errors.push(errorMsg);
      currentLog.finishedAt = new Date().toISOString();
      lastExportLog = currentLog; // Update global log on failure too
      throw err;
  }

  const logContent = logMessages.join('\n');
  log('Exportação concluída com sucesso.');

  return { csvContent, logContent, fileName };
}
//endregion
