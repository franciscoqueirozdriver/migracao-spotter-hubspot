
import { setTimeout } from 'timers/promises';

export interface ODataPage<T> {
  items: T[];
  pageIndex: number;
  nextUrlUsed: string;
}

export type LogCallback = (msg: string) => void;

interface ODataResponse<T> {
  value?: T[];
  '@odata.nextLink'?: string;
  '@odata.context'?: string;
}

/**
 * Generators pages of items from an OData endpoint.
 * Handles:
 * - Pagination via @odata.nextLink
 * - Throttling (min 700ms interval)
 * - Retries (exponential backoff) on 429/5xx
 */
export async function* fetchODataPages<T>(
  initialUrl: string,
  token: string,
  log?: LogCallback
): AsyncGenerator<ODataPage<T>> {
  let nextUrl: string | undefined = initialUrl;
  let pageIndex = 0;

  // Rate limiting state
  let lastRequestTime = 0;
  const MIN_INTERVAL_MS = 700;

  while (nextUrl) {
    pageIndex++;

    // 1. Throttle
    const now = Date.now();
    const elapsed = now - lastRequestTime;
    if (elapsed < MIN_INTERVAL_MS) {
      await setTimeout(MIN_INTERVAL_MS - elapsed);
    }
    lastRequestTime = Date.now();

    // 2. Fetch with Retry
    let response: Response | null = null;
    let attempt = 0;
    const maxRetries = 5;

    while (attempt < maxRetries) {
      attempt++;
      try {
        response = await fetch(nextUrl, {
          headers: {
            'Authorization': `Bearer ${token}`, // Try Bearer first, fallback or adjust based on known headers
            'token_exact': token, // Project uses this header based on previous files
          },
          cache: 'no-store',
        });

        if (response.ok) {
          break; // Success
        }

        // Handle Retryable errors
        if (response.status === 429 || (response.status >= 500 && response.status < 600)) {
          const delay = Math.pow(2, attempt) * 1000; // 2s, 4s, 8s, 16s, 32s
          log?.(`Warning: Request failed with ${response.status}. Retrying in ${delay/1000}s (Attempt ${attempt}/${maxRetries})...`);
          await setTimeout(delay);
          continue;
        }

        // Non-retryable error
        throw new Error(`Request failed with status ${response.status}: ${response.statusText}`);
      } catch (err: unknown) {
        // Network errors are retryable
        if (attempt < maxRetries) {
          const delay = Math.pow(2, attempt) * 1000;
          const errMsg = err instanceof Error ? err.message : String(err);
          log?.(`Warning: Network error "${errMsg}". Retrying in ${delay/1000}s (Attempt ${attempt}/${maxRetries})...`);
          await setTimeout(delay);
        } else {
          throw err;
        }
      }
    }

    if (!response || !response.ok) {
        // Should have been caught above, but safety check
        throw new Error(`Failed to fetch ${nextUrl} after ${maxRetries} attempts.`);
    }

    // 3. Parse
    const data: ODataResponse<T> = await response.json();
    const items = data.value ?? [];

    yield {
      items,
      pageIndex,
      nextUrlUsed: nextUrl
    };

    // 4. Next Link
    nextUrl = data['@odata.nextLink'];
  }
}
