# BookTrader

BookTrader is a cross-platform Expo app for local book trades in Prestige Shantiniketan, Whitefield, with room to expand across India later.

## MVP

- Google and email/password auth through Firebase Auth
- Legal-name onboarding, city, community, optional wishlist
- Marketplace with nearby distance in meters/kilometers
- Suggested matches from wishlist text
- Front/back book photos
- AI book-detail autofill through a secure backend endpoint
- Google Books fallback lookup from title/author
- Editable title, author, edition, and description fields
- Trade requests with open, claimed, completed listing status
- Per-user offer status: pending, accepted, declined, completed
- Chat only after an offer is accepted
- Ratings after completed trades
- 14-day listing lifetime with local expiry reminder
- Expo push token registration for server-side notifications

## Local Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy `.env.example` to `.env` and fill in your Firebase and Google OAuth values.

3. Start the app:

   ```bash
   npm start
   ```

4. Run a typecheck:

   ```bash
   npm run typecheck
   ```

The app opens in demo mode when Firebase env values are missing.

## Firebase

Create a Firebase project with:

- Authentication: Google provider and Email/Password provider enabled
- Firestore Database
- Firebase Storage

Deploy the rules in:

- `firebase/firestore.rules`
- `firebase/storage.rules`

Expected collections:

- `users`
- `listings`
- `tradeOffers`
- `ratings`

## Google Sign-In

Use package IDs:

- Android: `com.booktrader.booktrade`
- iOS: `com.booktrader.booktrade`

Add the OAuth client IDs to `.env`:

- `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`
- `EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID`
- `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`

For Android APKs built by GitHub Actions, add the debug keystore SHA-1 to the Android OAuth client if you want Google sign-in to work in the debug artifact.

## AI Autofill

Set `EXPO_PUBLIC_BOOK_AI_ENDPOINT` to a backend endpoint that accepts front/back image base64 and returns book metadata. The contract is documented in `firebase/book-autofill-contract.md`.

## GitHub Actions APK

The workflow at `.github/workflows/android-apk.yml` builds a debug APK on push, pull request, or manual dispatch.

Add these GitHub repository secrets:

- `EXPO_PUBLIC_FIREBASE_API_KEY`
- `EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN`
- `EXPO_PUBLIC_FIREBASE_PROJECT_ID`
- `EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET`
- `EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`
- `EXPO_PUBLIC_FIREBASE_APP_ID`
- `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`
- `EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID`
- `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`
- `EXPO_PUBLIC_BOOK_AI_ENDPOINT`
- `EXPO_PUBLIC_EAS_PROJECT_ID`

After a workflow run, download the artifact named `booktrader-debug-apk`.
