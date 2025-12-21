import { LogCallback } from './exporter';

// Type definitions for Spotter API response
export interface SpotterProduct {
  id: number;
  value: number | null | undefined;
  description: string;
}

interface SpotterResponse {
  '@odata.context': string;
  value: SpotterProduct[];
  '@odata.nextLink'?: string;
}

// Type definition for HubSpot product data
interface HubSpotProduct {
  'Nome <PRODUCT name>': string;
  'Price BRL <PRODUCT hs_price_brl>': string;
  'ID do Produto no Spotter': number;
}

export type ODataResponse<T> = {
  value?: T[];
  ['@odata.nextLink']?: string;
};

// Fetch all products from Spotter API, handling pagination and logging
async function fetchAllProducts(token: string, baseUrl: string, log: LogCallback): Promise<SpotterProduct[]> {
  let allProducts: SpotterProduct[] = [];
  let nextUrl: string | undefined = `${baseUrl}/v3/products`;
  let page = 1;

  while (nextUrl) {
    log(`Buscando página ${page} de produtos...`);
    const response = await fetch(nextUrl, {
      headers: {
        'token_exact': token,
      },
    });

    if (!response.ok) {
      const errorText = `A API do Spotter retornou um erro: ${response.status} ${response.statusText}. Por favor, verifique o status do serviço do Spotter.`;
      log(`ERRO: ${errorText}`);
      throw new Error(errorText);
    }

    const data: SpotterResponse = await response.json();

    if (data.value.length === 0) {
      log('Recebida uma página vazia. Finalizando a busca.');
      break;
    }

    allProducts = allProducts.concat(data.value);
    log(`Recebidos ${data.value.length} produtos.`);
    nextUrl = data['@odata.nextLink'];
    page++;
  }

  return allProducts;
}

export async function exportProductsToCsv(token: string, baseUrl: string, log: LogCallback): Promise<string> {
  log('Iniciando exportação de produtos...');
  const allProducts = await fetchAllProducts(token, baseUrl, log);
  log(`Total de ${allProducts.length} produtos recebidos.`);

  log('Removendo produtos duplicados...');
  const uniqueProducts = removeDuplicateProducts(allProducts);
  log(`Encontrados ${uniqueProducts.length} produtos únicos.`);

  log('Ordenando produtos...');
  uniqueProducts.sort((a, b) => a.description.localeCompare(b.description));

  log('Transformando dados para o formato HubSpot...');
  const hubspotProducts = transformToHubSpotFormat(uniqueProducts);

  log('Gerando conteúdo do arquivo CSV...');
  const csvContent = generateCsvContent(hubspotProducts);
  log('Geração do CSV concluída.');

  return csvContent;
}

/**
 * Enhanced OData fetcher with robust timeout protection.
 * @param initialUrl The OData endpoint URL
 * @param token Authentication token
 * @param log Logger callback
 * @param maxDurationSeconds Hard timeout in seconds (default 50s for Vercel 60s limit).
 *                           If exceeded, returns partial data instead of crashing.
 */
export async function fetchAllSpotterOData<T>(
  initialUrl: string,
  token: string,
  log: LogCallback,
  maxDurationSeconds: number = 50
): Promise<T[]> {
  let allItems: T[] = [];
  let nextUrl: string | undefined = initialUrl;

  // Optimize: Ensure we request a larger page size if not already specified
  if (!nextUrl.includes('$top') && !nextUrl.includes('$count')) {
      // Check if URL already has params
      const separator = nextUrl.includes('?') ? '&' : '?';
      nextUrl = `${nextUrl}${separator}$top=120`; // 120 is a safe batch size for many OData APIs
      log(`Otimização: Adicionando param $top=120 para reduzir requisições.`);
  }

  let page = 1;
  const maxRetries = 5;
  const visitedUrls = new Set<string>();
  const startTime = Date.now();
  const timeoutMs = maxDurationSeconds * 1000;

  log(`Iniciando busca OData em ${initialUrl} (Timeout: ${maxDurationSeconds}s)`);

  while (nextUrl) {
    // 1. TIMEOUT CHECK
    const elapsedTime = Date.now() - startTime;
    if (elapsedTime > timeoutMs) {
        log(`⚠️ ALERTA CRÍTICO: Limite de tempo de execução (${maxDurationSeconds}s) atingido.`);
        log(`⚠️ Retornando ${allItems.length} itens coletados até agora para evitar erro 504.`);
        log(`⚠️ A exportação está incompleta. Considere reduzir o escopo ou aumentar o limite do servidor.`);
        break;
    }

    // 2. Loop protection
    if (visitedUrls.has(nextUrl)) {
        log(`ALERTA: Loop de paginação detectado. URL já visitada: ${nextUrl}. Interrompendo busca.`);
        break;
    }
    visitedUrls.add(nextUrl);

    log(`Buscando página ${page} (Decorridos: ${(elapsedTime/1000).toFixed(1)}s)...`);

    let response: Response | null = null;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      // Check timeout inside retry loop too
      if (Date.now() - startTime > timeoutMs) break;

      try {
        response = await fetch(nextUrl, {
          headers: { 'token_exact': token },
        });

        if (response.status !== 503) {
          break; // Success or non-retryable error
        }
      } catch (error) {
        if (attempt === maxRetries) throw error;
      }

      if (attempt < maxRetries) {
        const delay = Math.pow(2, attempt - 1) * 1000; // 1s, 2s, 4s, 8s
        log(`Tentativa ${attempt} falhou com status 503 (ou erro de rede). Tentando novamente em ${delay / 1000}s...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    // Double check if we broke out due to timeout
    if (Date.now() - startTime > timeoutMs) {
         log(`⚠️ Timeout durante tentativas de conexão.`);
         break;
    }

    if (!response || !response.ok) {
      const statusText = response ? `${response.status} ${response.statusText}` : 'sem resposta';
      const errorText = `A API do Spotter retornou um erro: ${statusText}.`;
      log(`ERRO: ${errorText}`);
      // Don't throw entire process away if we have some data?
      // Ideally yes, but usually API error means stop.
      // Let's throw to be safe, but catching 504 is priority.
      throw new Error(errorText);
    }

    const data: ODataResponse<T> = await response.json();
    const items = data.value ?? [];

    if (items.length > 0) {
      allItems = allItems.concat(items);
      log(`Recebidos ${items.length} itens.`);
    } else {
      log(`Página ${page} retornou 0 itens.`);
    }

    nextUrl = data['@odata.nextLink'];
    page++;

    // Safety break
    if (page > 20000) {
        log('ALERTA: Limite máximo de páginas (20000) atingido. Interrompendo busca por segurança.');
        break;
    }
  }

  log(`Busca OData concluída. Total de ${allItems.length} itens recebidos.`);
  return allItems;
}

function removeDuplicateProducts(products: SpotterProduct[]): SpotterProduct[] {
    const seen = new Set<number>();
    return products.filter(product => {
        const duplicate = seen.has(product.id);
        seen.add(product.id);
        return !duplicate;
    });
}

function transformToHubSpotFormat(products: SpotterProduct[]): HubSpotProduct[] {
  return products.map(product => ({
    'Nome <PRODUCT name>': product.description,
    'Price BRL <PRODUCT hs_price_brl>': (product.value ?? 0).toString().replace('.', ','),
    'ID do Produto no Spotter': product.id,
  }));
}

function escapeCsvField(field: string | number): string {
  const str = String(field);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function generateCsvContent(products: HubSpotProduct[]): string {
  if (products.length === 0) {
    return '';
  }

  const headers = Object.keys(products[0]);
  const csvRows = products.map(product =>
    headers.map(header => escapeCsvField(product[header as keyof HubSpotProduct])).join(',')
  );

  return [headers.join(','), ...csvRows].join('\n');
}
