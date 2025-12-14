import { promises as fs } from 'fs';
import path from 'path';

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

// Environment variables
const SPOTTER_TOKEN = process.env.SPOTTER_TOKEN_EXACT;
const SPOTTER_BASE_URL = process.env.SPOTTER_BASE_URL || 'https://api.exactspotter.com';
const API_ENDPOINT = '/v3/products';

// Main function
async function main() {
  if (!SPOTTER_TOKEN) {
    console.error('Error: SPOTTER_TOKEN_EXACT environment variable is not set.');
    process.exit(1);
  }

  try {
    const allProducts = await fetchAllProducts();
    const uniqueProducts = removeDuplicateProducts(allProducts);
    uniqueProducts.sort((a, b) => a.description.localeCompare(b.description));

    const hubspotProducts = transformToHubSpotFormat(uniqueProducts);
    await writeCsv(hubspotProducts);

    console.log('Successfully exported products to products_hubspot.csv');
  } catch (error) {
    console.error('An error occurred during the export process:', error);
    process.exit(1);
  }
}

// Fetch all products from Spotter API, handling pagination
async function fetchAllProducts(): Promise<SpotterProduct[]> {
  let allProducts: SpotterProduct[] = [];
  let nextUrl: string | undefined = `${SPOTTER_BASE_URL}${API_ENDPOINT}`;

  while (nextUrl) {
    console.log(`Fetching from: ${nextUrl}`);
    const response = await fetch(nextUrl, {
      headers: {
        'token_exact': SPOTTER_TOKEN!,
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

// Write HubSpot products to CSV file
async function writeCsv(products: HubSpotProduct[]) {
  if (products.length === 0) {
    console.log('No products to write to CSV.');
    return;
  }

  const headers = Object.keys(products[0]);
  const csvRows = products.map(product =>
    headers.map(header => escapeCsvField(product[header as keyof HubSpotProduct])).join(',')
  );

  const csvContent = [headers.join(','), ...csvRows].join('\n');

  const filePath = path.join(process.cwd(), 'products_hubspot.csv');
  await fs.writeFile(filePath, csvContent, 'utf-8');
}

// Execute the script
main();
