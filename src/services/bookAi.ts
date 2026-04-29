import { BookDraft } from '../types';

const EMPTY_DRAFT: BookDraft = {
  title: '',
  author: '',
  edition: '',
  description: '',
};

function normalizeDraft(value: Partial<BookDraft>): BookDraft {
  return {
    title: value.title?.trim() ?? '',
    author: value.author?.trim() ?? '',
    edition: value.edition?.trim() ?? '',
    description: value.description?.trim() ?? '',
    isbn: value.isbn?.trim(),
    coverImageUrl: value.coverImageUrl?.trim() ?? null,
  };
}

export async function lookupBookFromGoogleBooks(query: string) {
  if (!query.trim()) {
    return EMPTY_DRAFT;
  }

  const response = await fetch(
    `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(query.trim())}&maxResults=3&langRestrict=en`,
  );

  if (!response.ok) {
    throw new Error(`Google Books lookup failed with ${response.status}`);
  }

  const payload = await response.json();

  type VolumeInfo = {
    title?: string;
    authors?: string[];
    publishedDate?: string;
    description?: string;
    industryIdentifiers?: { identifier?: string }[];
    imageLinks?: { thumbnail?: string; smallThumbnail?: string };
  };
  type Item = { volumeInfo: VolumeInfo };

  // Prefer the result with the most complete data (has cover + description).
  const items: Item[] = payload.items ?? [];
  const best = items.find((i) => i.volumeInfo.imageLinks && i.volumeInfo.description) ?? items[0];
  const item = best?.volumeInfo;

  if (!item) {
    return EMPTY_DRAFT;
  }

  const rawCover = item.imageLinks?.thumbnail ?? item.imageLinks?.smallThumbnail ?? null;
  return normalizeDraft({
    title: item.title,
    author: item.authors?.join(', '),
    edition: item.publishedDate,
    description: item.description,
    isbn: item.industryIdentifiers?.[0]?.identifier,
    coverImageUrl: rawCover ? rawCover.replace(/^http:\/\//, 'https://') : null,
  });
}
