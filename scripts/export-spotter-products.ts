import fs from 'node:fs/promises';

interface SpotterProduct {
  id: number;
  value?: number | null;
  description?: string | null;
}

interface SpotterProductsResponse {
  '@odata.context': string;
  value: SpotterProduct[];
  '@odata.nextLink'?: string;
}

const HUBSPOT_HEADERS = ['Nome', 'Price BRL', 'ID do Produto no Spotter'] as const;

function normalizeNextLink(nextLink: string | undefined, baseUrl: string): string | null {
  if (!nextLink) {
    return null;
  }

  try {
    return new URL(nextLink, baseUrl).toString();
  } catch (error) {
    throw new Error(`Invalid pagination link received: ${nextLink}`);
  }
}

function escapeCsvValue(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }

  return value;
}

function normalizePrice(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

async function fetchAllProducts(baseUrl: string, token: string): Promise<SpotterProduct[]> {
  const products: SpotterProduct[] = [];
  const seenIds = new Set<number>();
  let nextUrl: string | null = new URL('/v3/products', baseUrl).toString();

  while (nextUrl) {
    const response = await fetch(nextUrl, {
      headers: {
        token_exact: token,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch products from ${nextUrl}: ${response.status} ${response.statusText}`);
    }

    const data: SpotterProductsResponse = (await response.json()) as SpotterProductsResponse;

    if (!Array.isArray(data.value)) {
      throw new Error('Unexpected response shape: "value" is not an array');
    }

    for (const product of data.value) {
      if (typeof product.id !== 'number') {
        continue;
      }

      if (seenIds.has(product.id)) {
        continue;
      }

      seenIds.add(product.id);
      products.push(product);
    }

    nextUrl = normalizeNextLink(data['@odata.nextLink'], baseUrl);
  }

  return products;
}

function toCsv(products: SpotterProduct[]): string {
  const sorted = [...products].sort((first, second) => {
    const firstDescription = (first.description ?? '').trim();
    const secondDescription = (second.description ?? '').trim();

    return firstDescription.localeCompare(secondDescription, 'pt-BR', { sensitivity: 'base' });
  });

  const rows = sorted.map((product) => {
    const description = escapeCsvValue((product.description ?? '').trim());
    const price = normalizePrice(product.value);
    const spotterId = product.id;

    return `${description},${price},${spotterId}`;
  });

  return `${HUBSPOT_HEADERS.join(',')}\n${rows.join('\n')}`;
}

async function main(): Promise<void> {
  const token = process.env.SPOTTER_TOKEN_EXACT;

  if (!token) {
    throw new Error('Environment variable SPOTTER_TOKEN_EXACT is required');
  }

  const baseUrl = process.env.SPOTTER_BASE_URL ?? 'https://api.exactspotter.com';
  const products = await fetchAllProducts(baseUrl, token);
  const csv = toCsv(products);

  await fs.writeFile('products_hubspot.csv', csv, 'utf-8');
  console.log(`Exported ${products.length} products to products_hubspot.csv`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
