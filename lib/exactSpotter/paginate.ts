
export type LogCallback = (message: string) => void;

export type ODataResponse<T> = {
  value?: T[];
  ['@odata.nextLink']?: string;
};

/**
 * Generic OData fetcher with pagination and retry logic.
 */
export async function paginateOData<T>(
  baseUrl: string,
  endpoint: string,
  token: string,
  log: LogCallback = console.log,
  params: Record<string, string> = {}
): Promise<T[]> {
  let allItems: T[] = [];

  // Construct initial URL with params
  const url = new URL(`${baseUrl}${endpoint}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.append(key, value);
  }

  let nextUrl: string | undefined = url.toString();
  let page = 1;
  const maxRetries = 5;
  const visitedUrls = new Set<string>();

  log(`Starting OData fetch at ${nextUrl}`);

  while (nextUrl) {
    if (visitedUrls.has(nextUrl)) {
      log(`WARNING: Pagination loop detected. URL already visited: ${nextUrl}. Stopping.`);
      break;
    }
    visitedUrls.add(nextUrl);

    let response: Response | null = null;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        response = await fetch(nextUrl, {
          headers: { 'token_exact': token },
        });

        if (response.status !== 503 && response.status !== 504 && response.status !== 429) {
          break; // Success or non-retryable error
        }
      } catch (error) {
        if (attempt === maxRetries) {
            log(`Network error on attempt ${attempt}: ${error}`);
            throw error;
        }
      }

      if (attempt < maxRetries) {
        const delay = Math.pow(2, attempt - 1) * 1000;
        log(`Attempt ${attempt} failed (Status: ${response?.status}). Retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    if (!response || !response.ok) {
      const statusText = response ? `${response.status} ${response.statusText}` : 'no response';
      const errorBody = response ? await response.text().catch(() => '') : '';
      const errorText = `Spotter API error: ${statusText}. Body: ${errorBody}`;
      log(`ERROR: ${errorText}`);
      throw new Error(errorText);
    }

    const data: ODataResponse<T> = await response.json();
    const items = data.value ?? []; // Normalize to array

    if (items.length > 0) {
      allItems = allItems.concat(items);
    }

    // Log progress every page or so
    if (page % 10 === 0 || items.length === 0) {
        log(`Page ${page}: Fetched ${items.length} items. Total so far: ${allItems.length}`);
    }

    nextUrl = data['@odata.nextLink'];
    page++;
  }

  log(`OData fetch complete. Total items: ${allItems.length}`);
  return allItems;
}
