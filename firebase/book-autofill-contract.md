# Book Autofill Endpoint Contract

The app calls `EXPO_PUBLIC_BOOK_AI_ENDPOINT` from the mobile client after the user adds front and back cover photos.

Do not put OpenAI, Gemini, Vertex AI, or OCR credentials in the mobile app. Deploy this endpoint as a Firebase Function, Cloud Run service, or other authenticated backend.

## Request

```json
{
  "frontImage": {
    "mimeType": "image/jpeg",
    "data": "base64..."
  },
  "backImage": {
    "mimeType": "image/jpeg",
    "data": "base64..."
  }
}
```

## Response

```json
{
  "title": "Atomic Habits",
  "author": "James Clear",
  "edition": "2018",
  "description": "A practical book about habit formation and behavior change.",
  "isbn": "9780735211292"
}
```

The user can edit every returned field before publishing.
