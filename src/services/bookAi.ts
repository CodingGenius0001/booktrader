import { BookDraft } from '../types';

interface VolumeInfo {
  title?: string;
  authors?: string[];
  publishedDate?: string;
  description?: string;
  imageLinks?: { thumbnail?: string; smallThumbnail?: string; medium?: string };
  industryIdentifiers?: { type: string; identifier: string }[];
}

interface BooksApiResponse {
  totalItems?: number;
  items?: { volumeInfo: VolumeInfo }[];
  error?: { message: string; code: number };
}

const EMPTY_DRAFT: BookDraft = {
  title: '',
  author: '',
  edition: '',
  description: '',
};

// In-memory cache keyed by normalised query — avoids hammering the API
// on every debounce tick when the user pauses on the same title.
const cache = new Map<string, BookDraft>();

function normalizeDraft(v: Partial<BookDraft>): BookDraft {
  return {
    title: v.title?.trim() ?? '',
    author: v.author?.trim() ?? '',
    edition: v.edition?.trim() ?? '',
    description: v.description?.trim() ?? '',
    isbn: v.isbn?.trim() || undefined,
    coverImageUrl: v.coverImageUrl?.trim() || null,
  };
}

function bestCoverUrl(imageLinks?: VolumeInfo['imageLinks']): string | null {
  const raw =
    imageLinks?.medium ??
    imageLinks?.thumbnail ??
    imageLinks?.smallThumbnail ??
    null;
  if (!raw) return null;
  return raw.replace(/^http:\/\//, 'https://').replace('&zoom=1', '&zoom=0');
}

function pickBestItem(items: BooksApiResponse['items']): VolumeInfo | null {
  if (!items?.length) return null;
  return (
    items.find((i) => i.volumeInfo?.title && i.volumeInfo?.authors?.length)
      ?.volumeInfo ?? items[0]?.volumeInfo ?? null
  );
}

// Returns the Google Books API key to use, or empty string for unauthenticated.
// Priority:
//   1. EXPO_PUBLIC_GOOGLE_BOOKS_API_KEY  — dedicated Books key (recommended)
//   2. EXPO_PUBLIC_FIREBASE_API_KEY      — works if Books API is enabled on the
//                                          same GCP project as Firebase
//   3. (none)                            — unauthenticated, 429 risk
function apiKeyParam(): string {
  const key =
    process.env.EXPO_PUBLIC_GOOGLE_BOOKS_API_KEY ||
    process.env.EXPO_PUBLIC_FIREBASE_API_KEY ||
    '';
  return key ? `&key=${encodeURIComponent(key)}` : '';
}

async function fetchBooks(q: string): Promise<BooksApiResponse> {
  const url =
    `https://www.googleapis.com/books/v1/volumes` +
    `?q=${encodeURIComponent(q)}&maxResults=5&printType=books&orderBy=relevance` +
    apiKeyParam();
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) {
    throw new Error(`Google Books returned ${response.status}${response.status === 403 ? ' — enable the Books API in Google Cloud Console for your project' : response.status === 429 ? ' — rate limited; add EXPO_PUBLIC_GOOGLE_BOOKS_API_KEY to your .env' : ''}`);
  }
  try {
    return (await response.json()) as BooksApiResponse;
  } catch {
    throw new Error('Google Books returned an unexpected response format.');
  }
}

export async function lookupBookFromGoogleBooks(query: string): Promise<BookDraft> {
  const raw = query.trim();
  if (!raw) return EMPTY_DRAFT;

  // Title-case normalisation: "the secret" → "The Secret"
  const normalised = raw
    .toLowerCase()
    .replace(/(?:^|\s)\S/g, (c) => c.toUpperCase());

  const cacheKey = normalised.toLowerCase();
  if (cache.has(cacheKey)) return cache.get(cacheKey)!;

  // Attempt 1: plain keyword search
  let payload = await fetchBooks(normalised);
  if (payload.error) throw new Error(`Google Books: ${payload.error.message}`);

  // Attempt 2: explicit intitle: if keyword search returned nothing
  if (!payload.items?.length) {
    payload = await fetchBooks(`intitle:${normalised}`);
    if (payload.error) throw new Error(`Google Books: ${payload.error.message}`);
  }

  const volumeInfo = pickBestItem(payload.items);
  if (!volumeInfo) {
    cache.set(cacheKey, EMPTY_DRAFT);
    return EMPTY_DRAFT;
  }

  const isbn =
    volumeInfo.industryIdentifiers?.find((id) => id.type === 'ISBN_13')?.identifier ??
    volumeInfo.industryIdentifiers?.find((id) => id.type === 'ISBN_10')?.identifier;

  const result = normalizeDraft({
    title: volumeInfo.title,
    author: volumeInfo.authors?.join(', '),
    edition: volumeInfo.publishedDate,
    description: volumeInfo.description,
    isbn,
    coverImageUrl: bestCoverUrl(volumeInfo.imageLinks),
  });

  cache.set(cacheKey, result);
  return result;
}
