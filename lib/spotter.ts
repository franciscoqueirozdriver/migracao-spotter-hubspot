// Type definitions for Spotter API response
interface SpotterProduct {
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

// Fetch all products from Spotter API, handling pagination
async function fetchAllProducts(token: string, baseUrl: string): Promise<SpotterProduct[]> {
  let allProducts: SpotterProduct[] = [];
  let nextUrl: string | undefined = `${baseUrl}/v3/products`;

  while (nextUrl) {
    const response = await fetch(nextUrl, {
      headers: {
        'token_exact': token,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch data: ${response.status} ${response.statusText}`);
    }

    const data: SpotterResponse = await response.json();
    allProducts = allProducts.concat(data.value);
    nextUrl = data['@odata.nextLink'];
  }

  return allProducts;
}

// Remove duplicate products by ID
function removeDuplicateProducts(products: SpotterProduct[]): SpotterProduct[] {
    const seen = new Set<number>();
    return products.filter(product => {
        const duplicate = seen.has(product.id);
        seen.add(product.id);
        return !duplicate;
    });
}

// Transform Spotter products to HubSpot format
function transformToHubSpotFormat(products: SpotterProduct[]): HubSpotProduct[] {
  return products.map(product => ({
    'Nome <PRODUCT name>': product.description,
    'Price BRL <PRODUCT hs_price_brl>': (product.value ?? 0).toString().replace('.', ','),
    'ID do Produto no Spotter': product.id,
  }));
}

// Helper to escape CSV fields
function escapeCsvField(field: string | number): string {
  const str = String(field);
  // Escape double quotes by doubling them, and wrap the field in double quotes
  // if it contains a comma, a double quote, or a newline.
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

// Generate CSV content as a string
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

export async function exportProductsToCsv(token: string, baseUrl: string): Promise<string> {
  const allProducts = await fetchAllProducts(token, baseUrl);
  const uniqueProducts = removeDuplicateProducts(allProducts);
  uniqueProducts.sort((a, b) => a.description.localeCompare(b.description));
  const hubspotProducts = transformToHubSpotFormat(uniqueProducts);
  return generateCsvContent(hubspotProducts);
}
