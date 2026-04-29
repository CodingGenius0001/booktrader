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

export async function lookupBookFromGoogleBooks(query: string): Promise<BookDraft> {
  if (!query.trim()) return EMPTY_DRAFT;

  // No API key — Google Books allows unauthenticated requests (1 000/day per IP),
  // which is more than enough for this app. Sending the Firebase key would cause
  // a 403 unless the Books API is explicitly enabled on the same GCP project.
  const url =
    `https://www.googleapis.com/books/v1/volumes` +
    `?q=${encodeURIComponent(query.trim())}` +
    `&maxResults=5&printType=books&orderBy=relevance`;

  const response = await fetch(url, { headers: { Accept: 'application/json' } });

  if (!response.ok) {
    throw new Error(`Google Books API returned ${response.status}: ${response.statusText}`);
  }

  let payload: BooksApiResponse;
  try {
    payload = (await response.json()) as BooksApiResponse;
  } catch {
    throw new Error('Google Books returned an unexpected response format.');
  }

  if (payload.error) {
    throw new Error(`Google Books: ${payload.error.message}`);
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
