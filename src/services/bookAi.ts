import { File } from 'expo-file-system';

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
  };
}

async function imageToBase64(uri: string) {
  return new File(uri).base64();
}

export async function inferBookFromImages(frontUri: string, backUri: string) {
  const endpoint = process.env.EXPO_PUBLIC_BOOK_AI_ENDPOINT;

  if (!endpoint) {
    throw new Error(
      'Book AI endpoint is not configured. Add EXPO_PUBLIC_BOOK_AI_ENDPOINT after deploying your secure OCR/AI service.',
    );
  }

  const [frontImageBase64, backImageBase64] = await Promise.all([
    imageToBase64(frontUri),
    imageToBase64(backUri),
  ]);

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      frontImage: {
        mimeType: 'image/jpeg',
        data: frontImageBase64,
      },
      backImage: {
        mimeType: 'image/jpeg',
        data: backImageBase64,
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`Book AI endpoint failed with ${response.status}`);
  }

  const payload = (await response.json()) as Partial<BookDraft>;
  const draft = normalizeDraft(payload);

  if (!draft.title && !draft.author) {
    return EMPTY_DRAFT;
  }

  return draft;
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
  });
}
