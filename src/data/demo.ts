import { BookListing, TradeOffer, UserProfile } from '../types';

const now = Date.now();
const day = 24 * 60 * 60 * 1000;

export const demoUser: UserProfile = {
  id: 'demo-user',
  legalName: 'Aarav Mehta',
  email: 'aarav@example.com',
  city: 'Bengaluru',
  community: 'Prestige Shantiniketan, Whitefield',
  coordinates: {
    latitude: 12.9879,
    longitude: 77.7312,
  },
  wishlist: ['atomic habits', 'the psychology of money', 'ikigai'],
  ratingAverage: 4.8,
  ratingCount: 12,
};

export const demoListings: BookListing[] = [
  {
    id: 'listing-1',
    ownerId: 'neighbor-1',
    ownerName: 'Priya Nair',
    ownerCity: 'Bengaluru',
    ownerCommunity: 'Prestige Shantiniketan, Tower C',
    ownerCoordinates: {
      latitude: 12.9892,
      longitude: 77.7318,
    },
    title: 'Atomic Habits',
    author: 'James Clear',
    edition: '2018',
    description:
      'Clean paperback copy with light edge wear. Good for anyone building better daily systems.',
    frontImageUrl:
      'https://books.google.com/books/content?id=fFCjDQAAQBAJ&printsec=frontcover&img=1&zoom=1&source=gbs_api',
    backImageUrl: null,
    wants: 'Open to business, psychology, productivity, or recent fiction.',
    status: 'open',
    createdAt: now - 2 * day,
    expiresAt: now + 12 * day,
  },
  {
    id: 'listing-2',
    ownerId: 'neighbor-2',
    ownerName: 'Kabir Rao',
    ownerCity: 'Bengaluru',
    ownerCommunity: 'Prestige Shantiniketan, Forum Mall side',
    ownerCoordinates: {
      latitude: 12.9866,
      longitude: 77.7299,
    },
    title: 'The Psychology of Money',
    author: 'Morgan Housel',
    edition: '2020',
    description:
      'Almost new. No notes inside. Looking for non-fiction or a clean hardcover swap.',
    frontImageUrl:
      'https://books.google.com/books/content?id=TnrrDwAAQBAJ&printsec=frontcover&img=1&zoom=1&source=gbs_api',
    backImageUrl: null,
    wants: 'Finance, biographies, or Indian history.',
    status: 'open',
    createdAt: now - day,
    expiresAt: now + 13 * day,
  },
  {
    id: 'listing-3',
    ownerId: 'neighbor-3',
    ownerName: 'Mira Kapoor',
    ownerCity: 'Bengaluru',
    ownerCommunity: 'Prestige Shantiniketan, Tower J',
    ownerCoordinates: {
      latitude: 12.991,
      longitude: 77.7323,
    },
    title: 'Ikigai',
    author: 'Hector Garcia and Francesc Miralles',
    edition: '2017',
    description:
      'Compact hardbound edition. Some shelf marks, pages are clean.',
    frontImageUrl:
      'https://books.google.com/books/content?id=MDslDwAAQBAJ&printsec=frontcover&img=1&zoom=1&source=gbs_api',
    backImageUrl: null,
    wants: 'Short reads, classics, or children-friendly books.',
    status: 'claimed',
    claimedBy: 'other-user',
    createdAt: now - 6 * day,
    expiresAt: now + 8 * day,
  },
];

export const demoOffers: TradeOffer[] = [
  {
    id: 'offer-1',
    listingId: 'listing-1',
    listingTitle: 'Atomic Habits',
    listingOwnerId: 'neighbor-1',
    listingOwnerName: 'Priya Nair',
    requesterId: demoUser.id,
    requesterName: demoUser.legalName,
    offeredBooks: 'Deep Work + The Almanack of Naval Ravikant',
    note: 'Can meet near the clubhouse this weekend.',
    status: 'pending',
    createdAt: now - 4 * 60 * 60 * 1000,
    updatedAt: now - 4 * 60 * 60 * 1000,
    messages: [],
    ratedBy: [],
  },
  {
    id: 'offer-2',
    listingId: 'listing-2',
    listingTitle: 'The Psychology of Money',
    listingOwnerId: 'neighbor-2',
    listingOwnerName: 'Kabir Rao',
    requesterId: demoUser.id,
    requesterName: demoUser.legalName,
    offeredBooks: 'Zero to One',
    note: 'Happy to add another book if needed.',
    status: 'accepted',
    createdAt: now - day,
    updatedAt: now - 2 * 60 * 60 * 1000,
    ratedBy: [],
    messages: [
      {
        id: 'message-1',
        senderId: 'neighbor-2',
        senderName: 'Kabir Rao',
        text: 'Works for me. Clubhouse lobby tomorrow evening?',
        createdAt: now - 90 * 60 * 1000,
      },
    ],
  },
];
