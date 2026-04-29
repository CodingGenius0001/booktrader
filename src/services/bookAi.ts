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

function normalizeDraft(v: Partial<BookDraft>): BookDraft {
  return {
    title: v.title?.trim() ?? '',
    author: v.author?.trim() ?? '',
    edition: v.edition?.trim() ?? '',
    description: v.description?.trim() ?? '',
    isbn: v.isbn?.trim() || undefined,
    // Use || null so empty strings don't reach <Image source={{ uri: "" }}>
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
  // Google Books returns http:// URLs — Android blocks cleartext, force https.
  return raw.replace(/^http:\/\//, 'https://').replace('&zoom=1', '&zoom=0');
}

function pickBestItem(items: BooksApiResponse['items']): VolumeInfo | null {
  if (!items?.length) return null;
  // Prefer an item that has both a title and at least one author
  return (
    items.find((i) => i.volumeInfo?.title && i.volumeInfo?.authors?.length)
      ?.volumeInfo ?? items[0]?.volumeInfo ?? null
  );
}

async function fetchBooks(q: string): Promise<BooksApiResponse> {
  const url =
    `https://www.googleapis.com/books/v1/volumes` +
    `?q=${encodeURIComponent(q)}&maxResults=5&printType=books&orderBy=relevance`;
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) {
    throw new Error(`Google Books API returned ${response.status}: ${response.statusText}`);
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

  // Normalise casing: "the secret" → "The Secret" so Google's title-field
  // matching is more reliable for partial or all-lowercase input.
  const normalised = raw
    .toLowerCase()
    .replace(/(?:^|\s)\S/g, (c) => c.toUpperCase());

  // First attempt: plain keyword search with the normalised query.
  let payload = await fetchBooks(normalised);

  if (payload.error) {
    throw new Error(`Google Books: ${payload.error.message}`);
  }

  // If keyword search found nothing, retry with an explicit intitle: field
  // query — handles cases like all-lowercase or unusual punctuation.
  if (!payload.items?.length) {
    payload = await fetchBooks(`intitle:${normalised}`);
    if (payload.error) throw new Error(`Google Books: ${payload.error.message}`);
  }

  const volumeInfo = pickBestItem(payload.items);
  if (!volumeInfo) return EMPTY_DRAFT;

  const isbn =
    volumeInfo.industryIdentifiers?.find((id) => id.type === 'ISBN_13')?.identifier ??
    volumeInfo.industryIdentifiers?.find((id) => id.type === 'ISBN_10')?.identifier;

  return normalizeDraft({
    title: volumeInfo.title,
    author: volumeInfo.authors?.join(', '),
    edition: volumeInfo.publishedDate,
    description: volumeInfo.description,
    isbn,
    coverImageUrl: bestCoverUrl(volumeInfo.imageLinks),
  });
}
