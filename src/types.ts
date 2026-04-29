export type ListingStatus = 'open' | 'claimed' | 'completed';

export type OfferStatus = 'pending' | 'accepted' | 'declined' | 'completed';

export type Coordinates = {
  latitude: number;
  longitude: number;
};

export type UserProfile = {
  id: string;
  legalName: string;
  email: string;
  city: string;
  community: string;
  photoUrl?: string | null;
  coordinates?: Coordinates | null;
  wishlist: string[];
  ratingAverage?: number;
  ratingCount?: number;
  pushToken?: string | null;
};

export type BookDraft = {
  title: string;
  author: string;
  edition: string;
  description: string;
  isbn?: string;
  coverImageUrl?: string | null;
};

export type BookListing = BookDraft & {
  id: string;
  ownerId: string;
  ownerName: string;
  ownerCity: string;
  ownerCommunity: string;
  ownerCoordinates?: Coordinates | null;
  coverImageUrl?: string | null;
  frontImageUrl?: string | null;
  backImageUrl?: string | null;
  wants: string;
  status: ListingStatus;
  claimedBy?: string | null;
  createdAt: number;
  expiresAt: number;
};

export type TradeMessage = {
  id: string;
  senderId: string;
  senderName: string;
  text: string;
  createdAt: number;
};

export type TradeOffer = {
  id: string;
  listingId: string;
  listingTitle: string;
  listingOwnerId: string;
  listingOwnerName: string;
  requesterId: string;
  requesterName: string;
  offeredBooks: string;
  note: string;
  status: OfferStatus;
  createdAt: number;
  updatedAt: number;
  messages: TradeMessage[];
  ratedBy: string[];
  completedBy: string[];
};
