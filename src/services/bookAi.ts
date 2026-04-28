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
    `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(query.trim())}&maxResults=1`,
  );

  if (!response.ok) {
    throw new Error(`Google Books lookup failed with ${response.status}`);
  }

  const payload = await response.json();
  const item = payload.items?.[0]?.volumeInfo;

  if (!item) {
    return EMPTY_DRAFT;
  }

  return normalizeDraft({
    title: item.title,
    author: item.authors?.join(', '),
    edition: item.publishedDate,
    description: item.description,
    isbn: item.industryIdentifiers?.[0]?.identifier,
    coverImageUrl: (item.imageLinks?.thumbnail ?? item.imageLinks?.smallThumbnail ?? null)
      ?.replace(/^http:\/\//, 'https://') ?? null,
  });
}
