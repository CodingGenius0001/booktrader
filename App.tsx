import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import * as Google from 'expo-auth-session/providers/google';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import * as WebBrowser from 'expo-web-browser';
import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  GoogleAuthProvider,
  User,
  createUserWithEmailAndPassword,
  getAdditionalUserInfo,
  onAuthStateChanged,
  signInWithCredential,
  signInWithEmailAndPassword,
  signOut,
} from 'firebase/auth';
import {
  addDoc,
  collection,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';

import { firebase, hasFirebaseConfig } from './src/config/firebase';
import { demoListings, demoOffers, demoUser } from './src/data/demo';
import { lookupBookFromGoogleBooks } from './src/services/bookAi';
import { colors, radii, spacing } from './src/theme';
import {
  BookDraft,
  BookListing,
  Coordinates,
  OfferStatus,
  TradeMessage,
  TradeOffer,
  UserProfile,
} from './src/types';

WebBrowser.maybeCompleteAuthSession();

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: false,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

type TabKey = 'market' | 'add' | 'trades' | 'profile';
type AuthMode = 'login' | 'register';

const LISTING_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const DEFAULT_COMMUNITY = 'Prestige Shantiniketan, Whitefield';
const DEFAULT_CITY = 'Bengaluru';

const emptyDraft: BookDraft = {
  title: '',
  author: '',
  edition: '',
  description: '',
};

function now() {
  return Date.now();
}

function makeId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function kmBetween(a?: Coordinates | null, b?: Coordinates | null) {
  if (!a || !b) {
    return null;
  }

  const radius = 6371;
  const latDelta = ((b.latitude - a.latitude) * Math.PI) / 180;
  const lonDelta = ((b.longitude - a.longitude) * Math.PI) / 180;
  const lat1 = (a.latitude * Math.PI) / 180;
  const lat2 = (b.latitude * Math.PI) / 180;
  const h =
    Math.sin(latDelta / 2) ** 2 +
    Math.sin(lonDelta / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);

  return radius * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function formatDistance(km: number | null) {
  if (km === null) {
    return 'Nearby';
  }

  if (km < 1) {
    return `${Math.max(50, Math.round(km * 1000 / 50) * 50)} m`;
  }

  return `${km.toFixed(km < 10 ? 1 : 0)} km`;
}

function formatDaysLeft(expiresAt: number) {
  const daysLeft = Math.ceil((expiresAt - now()) / (24 * 60 * 60 * 1000));

  if (daysLeft <= 0) {
    return 'Expires today';
  }

  if (daysLeft === 1) {
    return '1 day left';
  }

  return `${daysLeft} days left`;
}

function statusColor(status: BookListing['status'] | OfferStatus) {
  if (status === 'open' || status === 'accepted') {
    return colors.success;
  }

  if (status === 'pending' || status === 'claimed') {
    return colors.warning;
  }

  if (status === 'declined') {
    return colors.danger;
  }

  return colors.muted;
}

function readableStatus(status: string) {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

async function requestCoordinates() {
  try {
    const permission = await Location.requestForegroundPermissionsAsync();

    if (permission.status !== 'granted') {
      return null;
    }

    const position = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });

    return {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
    };
  } catch {
    return null;
  }
}

async function registerPushToken(userId: string) {
  if (!firebase.db || !process.env.EXPO_PUBLIC_EAS_PROJECT_ID) {
    return;
  }

  const existing = await Notifications.getPermissionsAsync();
  const finalStatus =
    existing.status === 'granted'
      ? existing.status
      : (await Notifications.requestPermissionsAsync()).status;

  if (finalStatus !== 'granted') {
    return;
  }

  const token = await Notifications.getExpoPushTokenAsync({
    projectId: process.env.EXPO_PUBLIC_EAS_PROJECT_ID,
  });

  await setDoc(
    doc(firebase.db, 'users', userId),
    {
      pushToken: token.data,
      updatedAt: now(),
    },
    { merge: true },
  );
}

async function scheduleExpiryReminder(title: string) {
  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: 'BookTrader listing expires tomorrow',
        body: `${title} will leave the marketplace soon unless you renew it.`,
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: 13 * 24 * 60 * 60,
      },
    });
  } catch {
    // Push registration can cover real reminders once backend credentials are configured.
  }
}

function mapListing(id: string, value: Record<string, unknown>): BookListing {
  return {
    id,
    ownerId: String(value.ownerId ?? ''),
    ownerName: String(value.ownerName ?? ''),
    ownerCity: String(value.ownerCity ?? ''),
    ownerCommunity: String(value.ownerCommunity ?? ''),
    ownerCoordinates: (value.ownerCoordinates as Coordinates | null) ?? null,
    coverImageUrl: value.coverImageUrl ? String(value.coverImageUrl) : null,
    title: String(value.title ?? ''),
    author: String(value.author ?? ''),
    edition: String(value.edition ?? ''),
    description: String(value.description ?? ''),
    isbn: value.isbn ? String(value.isbn) : undefined,
    frontImageUrl: value.frontImageUrl ? String(value.frontImageUrl) : null,
    backImageUrl: value.backImageUrl ? String(value.backImageUrl) : null,
    wants: String(value.wants ?? ''),
    status: (value.status as BookListing['status']) ?? 'open',
    claimedBy: value.claimedBy ? String(value.claimedBy) : null,
    createdAt: Number(value.createdAt ?? now()),
    expiresAt: Number(value.expiresAt ?? now() + LISTING_TTL_MS),
  };
}

function mapOffer(id: string, value: Record<string, unknown>): TradeOffer {
  return {
    id,
    listingId: String(value.listingId ?? ''),
    listingTitle: String(value.listingTitle ?? ''),
    listingOwnerId: String(value.listingOwnerId ?? ''),
    listingOwnerName: String(value.listingOwnerName ?? ''),
    requesterId: String(value.requesterId ?? ''),
    requesterName: String(value.requesterName ?? ''),
    offeredBooks: String(value.offeredBooks ?? ''),
    note: String(value.note ?? ''),
    status: (value.status as OfferStatus) ?? 'pending',
    createdAt: Number(value.createdAt ?? now()),
    updatedAt: Number(value.updatedAt ?? now()),
    messages: (value.messages as TradeMessage[] | undefined) ?? [],
  };
}

export default function App() {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(hasFirebaseConfig);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [demoProfile, setDemoProfile] = useState<UserProfile>(demoUser);
  const [demoMode, setDemoMode] = useState(!hasFirebaseConfig);
  const [listings, setListings] = useState<BookListing[]>(demoListings);
  const [offers, setOffers] = useState<TradeOffer[]>(demoOffers);
  const [activeTab, setActiveTab] = useState<TabKey>('market');
  const [busy, setBusy] = useState(false);

  const [, googleResponse, promptGoogle] = Google.useIdTokenAuthRequest({
    clientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
    iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
    androidClientId: process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID,
  });

  const currentProfile = demoMode ? demoProfile : profile;
  const currentUserId = currentProfile?.id ?? firebaseUser?.uid ?? null;

  useEffect(() => {
    if (!firebase.auth) {
      setAuthLoading(false);
      return;
    }

    return onAuthStateChanged(firebase.auth, (user) => {
      setFirebaseUser(user);
      setAuthLoading(false);
    });
  }, []);

  useEffect(() => {
    if (!firebase.db || demoMode || !firebaseUser) {
      return;
    }

    const userRef = doc(firebase.db, 'users', firebaseUser.uid);
    return onSnapshot(userRef, (snapshot) => {
      if (!snapshot.exists()) {
        setProfile(null);
        return;
      }

      setProfile({
        id: firebaseUser.uid,
        ...(snapshot.data() as Omit<UserProfile, 'id'>),
      });
    });
  }, [demoMode, firebaseUser]);

  useEffect(() => {
    if (!firebase.db || demoMode || !currentUserId) {
      return;
    }

    const listingsQuery = query(collection(firebase.db, 'listings'), orderBy('createdAt', 'desc'));
    return onSnapshot(listingsQuery, (snapshot) => {
      const next = snapshot.docs
        .map((item) => mapListing(item.id, item.data()))
        .filter((item) => item.expiresAt >= now() || item.ownerId === currentUserId);
      setListings(next);
    });
  }, [currentUserId, demoMode]);

  useEffect(() => {
    if (!firebase.db || demoMode || !currentUserId) {
      return;
    }

    const offersQuery = query(collection(firebase.db, 'tradeOffers'), orderBy('updatedAt', 'desc'));
    return onSnapshot(offersQuery, (snapshot) => {
      const next = snapshot.docs
        .map((item) => mapOffer(item.id, item.data()))
        .filter(
          (item) => item.requesterId === currentUserId || item.listingOwnerId === currentUserId,
        );
      setOffers(next);
    });
  }, [currentUserId, demoMode]);

  useEffect(() => {
    if (!firebase.auth || !firebase.db || !googleResponse || googleResponse.type !== 'success') {
      return;
    }

    const idToken = googleResponse.authentication?.idToken;

    if (!idToken) {
      Alert.alert('Google sign-in failed', 'Google did not return an ID token.');
      return;
    }

    const credential = GoogleAuthProvider.credential(idToken);
    const db = firebase.db;
    signInWithCredential(firebase.auth, credential)
      .then(async (result) => {
        const info = getAdditionalUserInfo(result);
        if (info?.isNewUser && db) {
          await setDoc(
            doc(db, 'users', result.user.uid),
            {
              legalName: result.user.displayName ?? '',
              email: result.user.email ?? '',
              city: DEFAULT_CITY,
              community: DEFAULT_COMMUNITY,
              coordinates: null,
              wishlist: [],
              photoUrl: result.user.photoURL ?? null,
              ratingAverage: 0,
              ratingCount: 0,
              updatedAt: now(),
            },
            { merge: true },
          );
        }
      })
      .catch((error) => {
        Alert.alert('Google sign-in failed', error.message);
      });
  }, [googleResponse]);

  useEffect(() => {
    if (currentUserId && !demoMode) {
      registerPushToken(currentUserId).catch(() => undefined);
    }
  }, [currentUserId, demoMode]);

  async function handleEmailAuth(input: {
    mode: AuthMode;
    email: string;
    password: string;
    legalName: string;
    city: string;
    community: string;
  }) {
    if (!firebase.auth || !firebase.db) {
      Alert.alert('Firebase is not configured', 'Add your Firebase values to .env first.');
      return;
    }

    if (!input.email.trim() || !input.password.trim()) {
      Alert.alert('Missing details', 'Enter your email and password.');
      return;
    }

    try {
      setBusy(true);

      if (input.mode === 'register') {
        if (!input.legalName.trim()) {
          Alert.alert('Legal name required', 'Enter your legal name to create an account.');
          return;
        }

        const created = await createUserWithEmailAndPassword(
          firebase.auth,
          input.email.trim(),
          input.password,
        );
        const coordinates = await requestCoordinates();
        await saveProfile(created.user.uid, {
          legalName: input.legalName.trim(),
          email: input.email.trim(),
          city: input.city.trim() || DEFAULT_CITY,
          community: input.community.trim() || DEFAULT_COMMUNITY,
          coordinates,
          wishlist: [],
          photoUrl: created.user.photoURL,
        });
      } else {
        await signInWithEmailAndPassword(firebase.auth, input.email.trim(), input.password);
      }
    } catch (error) {
      Alert.alert('Authentication failed', error instanceof Error ? error.message : 'Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function saveProfile(
    userId: string,
    values: Omit<UserProfile, 'id' | 'ratingAverage' | 'ratingCount'>,
  ) {
    if (demoMode) {
      setDemoProfile((current) => ({
        ...current,
        ...values,
        id: current.id,
      }));
      return;
    }

    if (!firebase.db) {
      return;
    }

    await setDoc(
      doc(firebase.db, 'users', userId),
      {
        ...values,
        updatedAt: now(),
        ratingAverage: profile?.ratingAverage ?? 0,
        ratingCount: profile?.ratingCount ?? 0,
      },
      { merge: true },
    );
  }

  async function handleProfileComplete(values: {
    legalName: string;
    city: string;
    community: string;
    wishlist: string[];
  }) {
    const userId = firebaseUser?.uid ?? demoProfile.id;
    const coordinates = await requestCoordinates();

    await saveProfile(userId, {
      legalName: values.legalName.trim(),
      email: firebaseUser?.email ?? demoProfile.email,
      city: values.city.trim() || DEFAULT_CITY,
      community: values.community.trim() || DEFAULT_COMMUNITY,
      coordinates,
      wishlist: values.wishlist,
      photoUrl: firebaseUser?.photoURL,
    });
  }

  async function publishListing(input: {
    draft: BookDraft;
    wants: string;
  }) {
    if (!currentProfile) {
      return;
    }

    if (!input.draft.title.trim() || !input.draft.author.trim()) {
      Alert.alert('Book details required', 'Add at least the title and author before publishing.');
      return;
    }

    try {
      setBusy(true);
      const createdAt = now();
      const listingId = makeId('listing');

      const listing: BookListing = {
        ...input.draft,
        id: listingId,
        ownerId: currentProfile.id,
        ownerName: currentProfile.legalName,
        ownerCity: currentProfile.city,
        ownerCommunity: currentProfile.community,
        ownerCoordinates: currentProfile.coordinates ?? null,
        coverImageUrl: input.draft.coverImageUrl ?? null,
        frontImageUrl: input.draft.coverImageUrl ?? null,
        backImageUrl: null,
        wants: input.wants.trim(),
        status: 'open',
        claimedBy: null,
        createdAt,
        expiresAt: createdAt + LISTING_TTL_MS,
      };

      if (demoMode || !firebase.db) {
        setListings((current) => [listing, ...current]);
      } else {
        const { id: _id, ...listingData } = listing;
        await addDoc(collection(firebase.db, 'listings'), listingData);
      }

      await scheduleExpiryReminder(listing.title);
      setActiveTab('market');
    } catch (error) {
      Alert.alert('Publish failed', error instanceof Error ? error.message : 'Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function requestTrade(listing: BookListing, offeredBooks: string, note: string) {
    if (!currentProfile) {
      return;
    }

    if (listing.ownerId === currentProfile.id) {
      Alert.alert('This is your listing', 'Your own listings appear in the profile tab.');
      return;
    }

    if (!offeredBooks.trim()) {
      Alert.alert('Offer required', 'Add the book or terms you want to offer.');
      return;
    }

    const createdAt = now();
    const offer: TradeOffer = {
      id: makeId('offer'),
      listingId: listing.id,
      listingTitle: listing.title,
      listingOwnerId: listing.ownerId,
      listingOwnerName: listing.ownerName,
      requesterId: currentProfile.id,
      requesterName: currentProfile.legalName,
      offeredBooks: offeredBooks.trim(),
      note: note.trim(),
      status: 'pending',
      createdAt,
      updatedAt: createdAt,
      messages: [],
    };

    if (demoMode || !firebase.db) {
      setOffers((current) => [offer, ...current]);
      Alert.alert('Trade requested', `${listing.ownerName} can now accept or decline.`);
      return;
    }

    const { id: _id, ...offerData } = offer;
    await addDoc(collection(firebase.db, 'tradeOffers'), offerData);
    Alert.alert('Trade requested', `${listing.ownerName} can now accept or decline.`);
  }

  async function updateOfferStatus(offer: TradeOffer, status: OfferStatus) {
    const updatedAt = now();

    if (demoMode || !firebase.db) {
      setOffers((current) =>
        current.map((item) =>
          item.id === offer.id ? { ...item, status, updatedAt } : item,
        ),
      );

      if (status === 'accepted' || status === 'completed') {
        setListings((current) =>
          current.map((item) =>
            item.id === offer.listingId
              ? {
                  ...item,
                  status: status === 'accepted' ? 'claimed' : 'completed',
                  claimedBy: offer.requesterId,
                }
              : item,
          ),
        );
      }
      return;
    }

    const db = firebase.db;

    if (status === 'accepted') {
      const batch = writeBatch(db);
      batch.update(doc(db, 'tradeOffers', offer.id), {
        status: 'accepted',
        updatedAt,
      });
      batch.update(doc(db, 'listings', offer.listingId), {
        status: 'claimed',
        claimedBy: offer.requesterId,
      });

      const otherOffers = await getDocs(
        query(collection(db, 'tradeOffers'), where('listingId', '==', offer.listingId)),
      );

      otherOffers.docs.forEach((item) => {
        if (item.id !== offer.id) {
          batch.update(doc(db, 'tradeOffers', item.id), {
            status: 'declined',
            updatedAt,
          });
        }
      });

      await batch.commit();
      return;
    }

    await updateDoc(doc(db, 'tradeOffers', offer.id), {
      status,
      updatedAt,
    });

    if (status === 'completed') {
      await updateDoc(doc(db, 'listings', offer.listingId), {
        status: 'completed',
      });
    }
  }

  async function sendMessage(offer: TradeOffer, text: string) {
    if (!currentProfile || !text.trim()) {
      return;
    }

    const message: TradeMessage = {
      id: makeId('message'),
      senderId: currentProfile.id,
      senderName: currentProfile.legalName,
      text: text.trim(),
      createdAt: now(),
    };
    const messages = [...offer.messages, message];

    if (demoMode || !firebase.db) {
      setOffers((current) =>
        current.map((item) =>
          item.id === offer.id ? { ...item, messages, updatedAt: now() } : item,
        ),
      );
      return;
    }

    await updateDoc(doc(firebase.db, 'tradeOffers', offer.id), {
      messages,
      updatedAt: now(),
    });
  }

  async function rateTrade(offer: TradeOffer, rating: number) {
    if (!currentProfile) {
      return;
    }

    const ratedUserId =
      offer.requesterId === currentProfile.id ? offer.listingOwnerId : offer.requesterId;

    if (demoMode || !firebase.db) {
      Alert.alert('Rating saved', `${rating} star rating recorded for this trade.`);
      return;
    }

    const db = firebase.db;
    await addDoc(collection(db, 'ratings'), {
      offerId: offer.id,
      fromUserId: currentProfile.id,
      toUserId: ratedUserId,
      rating,
      createdAt: now(),
    });

    const ratingsSnap = await getDocs(
      query(collection(db, 'ratings'), where('toUserId', '==', ratedUserId)),
    );
    const allRatings = ratingsSnap.docs.map((d) => d.data().rating as number);
    const ratingCount = allRatings.length;
    const ratingAverage = allRatings.reduce((a, b) => a + b, 0) / ratingCount;
    await updateDoc(doc(db, 'users', ratedUserId), {
      ratingAverage: Math.round(ratingAverage * 10) / 10,
      ratingCount,
    });

    Alert.alert('Rating saved', `${rating} star rating recorded for this trade.`);
  }

  async function handleSignOut() {
    if (demoMode) {
      setDemoMode(false);
      setProfile(null);
      setActiveTab('market');
      return;
    }

    if (firebase.auth) {
      await signOut(firebase.auth);
    }
  }

  if (authLoading) {
    return <LoadingScreen />;
  }

  if (!demoMode && !firebaseUser) {
    return (
      <AuthScreen
        busy={busy}
        onEmailAuth={handleEmailAuth}
        onGoogle={() => promptGoogle()}
        onDemo={() => setDemoMode(true)}
      />
    );
  }

  if (!currentProfile?.legalName) {
    return (
      <ProfileOnboarding
        busy={busy}
        email={firebaseUser?.email ?? demoProfile.email}
        initialName={firebaseUser?.displayName ?? ''}
        onComplete={handleProfileComplete}
      />
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" />
      <View style={styles.appShell}>
        <Header profile={currentProfile} demoMode={demoMode || !hasFirebaseConfig} />
        {activeTab === 'market' && (
          <MarketScreen
            currentProfile={currentProfile}
            listings={listings}
            offers={offers}
            onRequestTrade={requestTrade}
          />
        )}
        {activeTab === 'add' && (
          <AddListingScreen
            busy={busy}
            onGoogleLookup={lookupBookFromGoogleBooks}
            onPublish={publishListing}
          />
        )}
        {activeTab === 'trades' && (
          <TradesScreen
            currentProfile={currentProfile}
            offers={offers}
            onAccept={(offer) => updateOfferStatus(offer, 'accepted')}
            onDecline={(offer) => updateOfferStatus(offer, 'declined')}
            onComplete={(offer) => updateOfferStatus(offer, 'completed')}
            onSendMessage={sendMessage}
            onRate={rateTrade}
          />
        )}
        {activeTab === 'profile' && (
          <ProfileScreen
            profile={currentProfile}
            listings={listings}
            onSave={handleProfileComplete}
            onSignOut={handleSignOut}
          />
        )}
      </View>
      <TabBar activeTab={activeTab} onChange={setActiveTab} />
    </SafeAreaView>
  );
}

function LoadingScreen() {
  return (
    <SafeAreaView style={[styles.safeArea, styles.center]}>
      <ActivityIndicator color={colors.teal} />
      <Text style={styles.loadingText}>Opening BookTrader</Text>
    </SafeAreaView>
  );
}

function Header({ profile, demoMode }: { profile: UserProfile; demoMode: boolean }) {
  return (
    <View style={styles.header}>
      <View>
        <Text style={styles.brand}>BookTrader</Text>
        <Text style={styles.headerSubtext}>
          {profile.community} {demoMode ? 'Demo' : ''}
        </Text>
      </View>
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>
          {profile.legalName
            .split(' ')
            .filter(Boolean)
            .slice(0, 2)
            .map((part) => part[0])
            .join('')
            .toUpperCase()}
        </Text>
      </View>
    </View>
  );
}

function AuthScreen({
  busy,
  onEmailAuth,
  onGoogle,
  onDemo,
}: {
  busy: boolean;
  onEmailAuth: (input: {
    mode: AuthMode;
    email: string;
    password: string;
    legalName: string;
    city: string;
    community: string;
  }) => void;
  onGoogle: () => void;
  onDemo: () => void;
}) {
  const [mode, setMode] = useState<AuthMode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [legalName, setLegalName] = useState('');
  const [city, setCity] = useState(DEFAULT_CITY);
  const [community, setCommunity] = useState(DEFAULT_COMMUNITY);

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flexOne}
      >
        <ScrollView
          contentContainerStyle={styles.authScroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.authHero}>
            <Text style={styles.brandLarge}>BookTrader</Text>
            <Text style={styles.authHeadline}>Local book trades for Prestige Shantiniketan.</Text>
            <Text style={styles.authSubtext}>
              List books, discover wishlist matches nearby, and complete meetup trades with neighbors.
            </Text>
          </View>

          <View style={styles.authPanel}>
            <SegmentedControl
              value={mode}
              onChange={(next) => setMode(next as AuthMode)}
              options={[
                { label: 'Login', value: 'login' },
                { label: 'Register', value: 'register' },
              ]}
            />
            {mode === 'register' && (
              <>
                <Field
                  label="Legal name"
                  value={legalName}
                  onChangeText={setLegalName}
                  autoCapitalize="words"
                />
                <Field label="City" value={city} onChangeText={setCity} autoCapitalize="words" />
                <Field
                  label="Community"
                  value={community}
                  onChangeText={setCommunity}
                  autoCapitalize="words"
                />
              </>
            )}
            <Field
              label="Email"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
            />
            <Field
              label="Password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
            />
            <PrimaryButton
              label={mode === 'login' ? 'Continue' : 'Create account'}
              icon="mail-outline"
              loading={busy}
              onPress={() =>
                onEmailAuth({
                  mode,
                  email,
                  password,
                  legalName,
                  city,
                  community,
                })
              }
            />
            <SecondaryButton label="Continue with Google" icon="logo-google" onPress={onGoogle} />
            <Pressable onPress={onDemo} style={styles.demoLink}>
              <Text style={styles.demoLinkText}>Preview without Firebase credentials</Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function ProfileOnboarding({
  busy,
  email,
  initialName,
  onComplete,
}: {
  busy: boolean;
  email: string;
  initialName: string;
  onComplete: (values: {
    legalName: string;
    city: string;
    community: string;
    wishlist: string[];
  }) => void;
}) {
  const [legalName, setLegalName] = useState(initialName);
  const [city, setCity] = useState(DEFAULT_CITY);
  const [community, setCommunity] = useState(DEFAULT_COMMUNITY);
  const [wishlistText, setWishlistText] = useState('');

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flexOne}
      >
        <ScrollView
          contentContainerStyle={styles.onboarding}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.brand}>BookTrader</Text>
          <Text style={styles.sectionTitle}>Finish your profile</Text>
          <Text style={styles.mutedText}>{email}</Text>
          <Field
            label="Legal name"
            value={legalName}
            onChangeText={setLegalName}
            autoCapitalize="words"
          />
          <Field label="City" value={city} onChangeText={setCity} autoCapitalize="words" />
          <Field
            label="Community"
            value={community}
            onChangeText={setCommunity}
            autoCapitalize="words"
          />
          <Field
            label="Wishlist"
            value={wishlistText}
            onChangeText={setWishlistText}
            placeholder="Atomic Habits, Ikigai, Harry Potter"
            multiline
          />
          <PrimaryButton
            label="Enter marketplace"
            icon="arrow-forward"
            loading={busy}
            onPress={() =>
              onComplete({
                legalName,
                city,
                community,
                wishlist: wishlistText
                  .split(',')
                  .map((item) => item.trim())
                  .filter(Boolean),
              })
            }
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function MarketScreen({
  currentProfile,
  listings,
  offers,
  onRequestTrade,
}: {
  currentProfile: UserProfile;
  listings: BookListing[];
  offers: TradeOffer[];
  onRequestTrade: (listing: BookListing, offeredBooks: string, note: string) => void;
}) {
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<BookListing | null>(null);

  const myListings = useMemo(
    () => listings.filter((l) => l.ownerId === currentProfile.id && l.status === 'open'),
    [listings, currentProfile.id],
  );

  const activeListings = useMemo(() => {
    const queryText = search.trim().toLowerCase();
    return listings
      .filter((listing) => listing.ownerId !== currentProfile.id)
      .filter((listing) => listing.expiresAt >= now())
      .filter((listing) => {
        if (!queryText) {
          return true;
        }

        return [listing.title, listing.author, listing.edition, listing.isbn, listing.description]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(queryText);
      })
      .sort((a, b) => {
        const aDistance = kmBetween(currentProfile.coordinates, a.ownerCoordinates) ?? 999;
        const bDistance = kmBetween(currentProfile.coordinates, b.ownerCoordinates) ?? 999;
        return aDistance - bDistance;
      });
  }, [currentProfile, listings, search]);

  const suggestions = useMemo(() => {
    const wishlist = currentProfile.wishlist.map((item) => item.toLowerCase());
    return activeListings.filter((listing) =>
      wishlist.some((wish) =>
        `${listing.title} ${listing.author} ${listing.description}`.toLowerCase().includes(wish),
      ),
    );
  }, [activeListings, currentProfile.wishlist]);

  return (
    <View style={styles.screen}>
      <View style={styles.searchRow}>
        <Ionicons name="search" size={18} color={colors.muted} />
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search title, author, ISBN"
          placeholderTextColor={colors.muted}
          style={styles.searchInput}
        />
      </View>
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {suggestions.length > 0 && (
          <View style={styles.band}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Suggested Matches</Text>
              <Text style={styles.mutedText}>{suggestions.length} nearby</Text>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {suggestions.map((listing) => (
                <CompactListingCard
                  key={listing.id}
                  listing={listing}
                  distance={formatDistance(kmBetween(currentProfile.coordinates, listing.ownerCoordinates))}
                  onPress={() => setSelected(listing)}
                />
              ))}
            </ScrollView>
          </View>
        )}

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Marketplace</Text>
          <Text style={styles.mutedText}>{activeListings.length} listings</Text>
        </View>
        {activeListings.length === 0 ? (
          <EmptyState icon="book-outline" title="No listings found" />
        ) : (
          activeListings.map((listing) => (
            <ListingCard
              key={listing.id}
              listing={listing}
              personalStatus={personalListingStatus(listing, offers, currentProfile.id)}
              distance={formatDistance(kmBetween(currentProfile.coordinates, listing.ownerCoordinates))}
              highlight={wantsYourBook(listing, myListings)}
              onPress={() => setSelected(listing)}
            />
          ))
        )}
      </ScrollView>

      <TradeRequestModal
        listing={selected}
        myListings={myListings}
        onClose={() => setSelected(null)}
        onSubmit={(listing, offeredBooks, note) => {
          setSelected(null);
          onRequestTrade(listing, offeredBooks, note);
        }}
      />
    </View>
  );
}

function personalListingStatus(
  listing: BookListing,
  offers: TradeOffer[],
  currentUserId: string,
) {
  if (listing.ownerId === currentUserId) {
    return listing.status;
  }

  const ownOffer = offers.find(
    (offer) => offer.listingId === listing.id && offer.requesterId === currentUserId,
  );

  if (ownOffer) {
    return ownOffer.status;
  }

  return listing.status;
}

function wantsYourBook(listing: BookListing, myListings: BookListing[]): boolean {
  const wants = listing.wants?.toLowerCase() ?? '';
  if (!wants || myListings.length === 0) return false;
  return myListings.some((l) => {
    const keywords = l.title.toLowerCase().split(/\s+/).filter((w) => w.length > 4);
    return keywords.some((word) => wants.includes(word));
  });
}

function AddListingScreen({
  busy,
  onGoogleLookup,
  onPublish,
}: {
  busy: boolean;
  onGoogleLookup: (query: string) => Promise<BookDraft>;
  onPublish: (input: {
    draft: BookDraft;
    wants: string;
  }) => Promise<void>;
}) {
  const [draft, setDraft] = useState<BookDraft>(emptyDraft);
  const [wants, setWants] = useState('');
  const [autofilling, setAutofilling] = useState(false);
  const lookupTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  async function runLookup(query: string) {
    const next = await onGoogleLookup(query);
    setDraft((current) => ({
      ...current,
      ...next,
      title: current.title,
    }));
  }

  useEffect(() => {
    if (lookupTimer.current) {
      clearTimeout(lookupTimer.current);
    }

    const title = draft.title.trim();

    if (title.length < 3) {
      return;
    }

    let cancelled = false;
    lookupTimer.current = setTimeout(() => {
      setAutofilling(true);
      onGoogleLookup(title)
        .then((next) => {
          if (cancelled) {
            return;
          }

          setDraft((current) => ({
            ...current,
            ...next,
            title: current.title,
          }));
        })
        .catch(() => undefined)
        .finally(() => setAutofilling(false));
    }, 600);

    return () => {
      cancelled = true;
      if (lookupTimer.current) {
        clearTimeout(lookupTimer.current);
      }
    };
  }, [draft.title, onGoogleLookup]);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.scrollContent}>
      <Text style={styles.sectionTitle}>New Listing</Text>
      <View style={styles.actionRow}>
        <SecondaryButton
          label="Refresh lookup"
          icon="library-outline"
          loading={autofilling}
          onPress={() => {
            if (!draft.title.trim()) {
              Alert.alert('Title required', 'Enter a book title first.');
              return;
            }

            setAutofilling(true);
            runLookup(draft.title)
              .catch(() => undefined)
              .finally(() => setAutofilling(false));
          }}
        />
      </View>
      <View style={styles.coverPreviewWrap}>
        <Text style={styles.label}>Cover preview</Text>
        {draft.coverImageUrl ? (
          <Image source={{ uri: draft.coverImageUrl }} style={styles.coverPreview} />
        ) : (
          <View style={styles.coverPreviewFallback}>
            <Ionicons name="book-outline" size={32} color={colors.teal} />
            <Text style={styles.mutedText}>Type a title to fetch a cover from Google Books.</Text>
          </View>
        )}
      </View>
      <Field
        label="Title"
        value={draft.title}
        onChangeText={(title) => setDraft((current) => ({ ...current, title }))}
      />
      <Field
        label="Author"
        value={draft.author}
        onChangeText={(author) => setDraft((current) => ({ ...current, author }))}
      />
      <Field
        label="Edition"
        value={draft.edition}
        onChangeText={(edition) => setDraft((current) => ({ ...current, edition }))}
      />
      <Field
        label="Description"
        value={draft.description}
        onChangeText={(description) => setDraft((current) => ({ ...current, description }))}
        multiline
      />
      <Field
        label="What you want in return"
        value={wants}
        onChangeText={setWants}
        placeholder="Book-for-book, multiple books, or terms to discuss"
        multiline
      />
      <PrimaryButton
        label="Publish for 14 days"
        icon="cloud-upload-outline"
        loading={busy}
        onPress={() => onPublish({ draft, wants })}
      />
    </ScrollView>
  );
}

function TradesScreen({
  currentProfile,
  offers,
  onAccept,
  onDecline,
  onComplete,
  onSendMessage,
  onRate,
}: {
  currentProfile: UserProfile;
  offers: TradeOffer[];
  onAccept: (offer: TradeOffer) => void;
  onDecline: (offer: TradeOffer) => void;
  onComplete: (offer: TradeOffer) => void;
  onSendMessage: (offer: TradeOffer, text: string) => void;
  onRate: (offer: TradeOffer, rating: number) => void;
}) {
  const [filter, setFilter] = useState<'all' | 'incoming' | 'outgoing'>('all');
  const visibleOffers = offers.filter((offer) => {
    if (filter === 'incoming') {
      return offer.listingOwnerId === currentProfile.id;
    }

    if (filter === 'outgoing') {
      return offer.requesterId === currentProfile.id;
    }

    return true;
  });

  return (
    <View style={styles.screen}>
      <SegmentedControl
        value={filter}
        onChange={(next) => setFilter(next as 'all' | 'incoming' | 'outgoing')}
        options={[
          { label: 'All', value: 'all' },
          { label: 'Incoming', value: 'incoming' },
          { label: 'Outgoing', value: 'outgoing' },
        ]}
      />
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {visibleOffers.length === 0 ? (
          <EmptyState icon="swap-horizontal-outline" title="No trade activity yet" />
        ) : (
          visibleOffers.map((offer) => (
            <TradeCard
              key={offer.id}
              offer={offer}
              currentProfile={currentProfile}
              onAccept={() => onAccept(offer)}
              onDecline={() => onDecline(offer)}
              onComplete={() => onComplete(offer)}
              onSend={(text) => onSendMessage(offer, text)}
              onRate={(rating) => onRate(offer, rating)}
            />
          ))
        )}
      </ScrollView>
    </View>
  );
}

function ProfileScreen({
  profile,
  listings,
  onSave,
  onSignOut,
}: {
  profile: UserProfile;
  listings: BookListing[];
  onSave: (values: {
    legalName: string;
    city: string;
    community: string;
    wishlist: string[];
  }) => void;
  onSignOut: () => void;
}) {
  const [legalName, setLegalName] = useState(profile.legalName);
  const [city, setCity] = useState(profile.city);
  const [community, setCommunity] = useState(profile.community);
  const [wishlistText, setWishlistText] = useState(profile.wishlist.join(', '));
  const ownListings = listings.filter((listing) => listing.ownerId === profile.id);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.scrollContent}>
      <View style={styles.profileSummary}>
        <View style={styles.avatarLarge}>
          <Text style={styles.avatarLargeText}>
            {profile.legalName
              .split(' ')
              .filter(Boolean)
              .slice(0, 2)
              .map((part) => part[0])
              .join('')
              .toUpperCase()}
          </Text>
        </View>
        <View style={styles.profileSummaryText}>
          <Text style={styles.sectionTitle}>{profile.legalName}</Text>
          <Text style={styles.mutedText}>{profile.city}</Text>
          <View style={styles.inlineRating}>
            <Ionicons name="star" color={colors.brass} size={16} />
            <Text style={styles.mutedText}>
              {(profile.ratingAverage ?? 0).toFixed(1)} ({profile.ratingCount ?? 0})
            </Text>
          </View>
        </View>
      </View>
      <Field label="Legal name" value={legalName} onChangeText={setLegalName} />
      <Field label="City" value={city} onChangeText={setCity} />
      <Field label="Community" value={community} onChangeText={setCommunity} />
      <Field
        label="Wishlist"
        value={wishlistText}
        onChangeText={setWishlistText}
        multiline
      />
      <PrimaryButton
        label="Save profile"
        icon="save-outline"
        onPress={() =>
          onSave({
            legalName,
            city,
            community,
            wishlist: wishlistText
              .split(',')
              .map((item) => item.trim())
              .filter(Boolean),
          })
        }
      />
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Your Listings</Text>
        <Text style={styles.mutedText}>{ownListings.length}</Text>
      </View>
      {ownListings.map((listing) => (
        <ListingCard
          key={listing.id}
          listing={listing}
          personalStatus={listing.status}
          distance={formatDaysLeft(listing.expiresAt)}
        />
      ))}
      <SecondaryButton label="Sign out" icon="log-out-outline" onPress={onSignOut} />
    </ScrollView>
  );
}

function ListingCard({
  listing,
  personalStatus,
  distance,
  highlight,
  onPress,
}: {
  listing: BookListing;
  personalStatus: string;
  distance: string;
  highlight?: boolean;
  onPress?: () => void;
}) {
  return (
    <Pressable style={styles.listingCard} onPress={onPress} disabled={!onPress}>
      <BookCover uri={listing.coverImageUrl ?? listing.frontImageUrl} size="large" />
      <View style={styles.listingContent}>
        <View style={styles.listingTitleRow}>
          <Text style={styles.cardTitle} numberOfLines={1}>
            {listing.title}
          </Text>
          <StatusPill status={personalStatus} />
        </View>
        <Text style={styles.cardSubtitle} numberOfLines={1}>
          {listing.author} {listing.edition ? `- ${listing.edition}` : ''}
        </Text>
        <Text style={styles.cardBody} numberOfLines={2}>
          {listing.description}
        </Text>
        <View style={styles.metaRow}>
          <Ionicons name="location-outline" size={15} color={colors.muted} />
          <Text style={styles.metaText}>{distance}</Text>
          <Text style={styles.dot}>.</Text>
          <Text style={styles.metaText}>{listing.ownerCommunity}</Text>
        </View>
        <Text style={styles.tradeNote} numberOfLines={2}>
          Wants: {listing.wants || 'Open to offers'}
        </Text>
        {highlight && (
          <View style={styles.mutualMatchBadge}>
            <Ionicons name="swap-horizontal-outline" size={12} color={colors.teal} />
            <Text style={styles.mutualMatchText}>They want your book</Text>
          </View>
        )}
      </View>
    </Pressable>
  );
}

function CompactListingCard({
  listing,
  distance,
  onPress,
}: {
  listing: BookListing;
  distance: string;
  onPress: () => void;
}) {
  return (
    <Pressable style={styles.compactCard} onPress={onPress}>
      <BookCover uri={listing.coverImageUrl ?? listing.frontImageUrl} size="compact" />
      <Text style={styles.compactTitle} numberOfLines={2}>
        {listing.title}
      </Text>
      <Text style={styles.metaText}>{distance}</Text>
    </Pressable>
  );
}

function BookCover({ uri, size }: { uri?: string | null; size: 'large' | 'compact' }) {
  const style = size === 'large' ? styles.coverLarge : styles.coverCompact;

  if (!uri) {
    return (
      <View style={[style, styles.coverFallback]}>
        <Ionicons name="book-outline" size={size === 'large' ? 30 : 24} color={colors.teal} />
      </View>
    );
  }

  return <Image source={{ uri }} style={style} />;
}

function TradeRequestModal({
  listing,
  myListings,
  onClose,
  onSubmit,
}: {
  listing: BookListing | null;
  myListings: BookListing[];
  onClose: () => void;
  onSubmit: (listing: BookListing, offeredBooks: string, note: string) => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [note, setNote] = useState('');

  useEffect(() => {
    if (listing) {
      setSelectedId(null);
      setNote('');
    }
  }, [listing]);

  const selectedBook = myListings.find((l) => l.id === selectedId);

  function handleSubmit() {
    if (!listing) return;
    if (myListings.length > 0 && !selectedBook) {
      Alert.alert('Pick a book', 'Select one of your listed books to offer in this trade.');
      return;
    }
    const offeredBooks = selectedBook ? `${selectedBook.title} by ${selectedBook.author}` : '';
    onSubmit(listing, offeredBooks, note);
  }

  return (
    <Modal transparent visible={Boolean(listing)} animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalSheet}>
          {listing && (
            <>
              <View style={styles.modalHeader}>
                <View style={styles.flexOne}>
                  <Text style={styles.sectionTitle} numberOfLines={1}>{listing.title}</Text>
                  <Text style={styles.mutedText}>Trade with {listing.ownerName}</Text>
                </View>
                <IconButton icon="close" onPress={onClose} />
              </View>
              <Text style={styles.label}>Pick a book to offer</Text>
              {myListings.length === 0 ? (
                <View style={styles.emptyOfferHint}>
                  <Ionicons name="book-outline" size={24} color={colors.muted} />
                  <Text style={styles.mutedText}>
                    List a book first — you need something to offer in a trade.
                  </Text>
                </View>
              ) : (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  style={styles.offerPicker}
                >
                  {myListings.map((book) => {
                    const selected = book.id === selectedId;
                    return (
                      <Pressable
                        key={book.id}
                        onPress={() => setSelectedId(book.id)}
                        style={[styles.offerBookCard, selected && styles.offerBookCardSelected]}
                      >
                        <BookCover uri={book.coverImageUrl ?? book.frontImageUrl} size="compact" />
                        <Text style={styles.offerBookTitle} numberOfLines={2}>
                          {book.title}
                        </Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              )}
              <Field
                label="Meetup note"
                value={note}
                onChangeText={setNote}
                placeholder="Clubhouse, lobby, preferred timing"
                multiline
              />
              <PrimaryButton
                label="Request trade"
                icon="swap-horizontal-outline"
                onPress={handleSubmit}
              />
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

function TradeCard({
  offer,
  currentProfile,
  onAccept,
  onDecline,
  onComplete,
  onSend,
  onRate,
}: {
  offer: TradeOffer;
  currentProfile: UserProfile;
  onAccept: () => void;
  onDecline: () => void;
  onComplete: () => void;
  onSend: (text: string) => void;
  onRate: (rating: number) => void;
}) {
  const [message, setMessage] = useState('');
  const isOwner = offer.listingOwnerId === currentProfile.id;
  const isAccepted = offer.status === 'accepted';
  const isCompleted = offer.status === 'completed';

  return (
    <View style={styles.tradeCard}>
      <View style={styles.listingTitleRow}>
        <View style={styles.flexOne}>
          <Text style={styles.cardTitle}>{offer.listingTitle}</Text>
          <Text style={styles.cardSubtitle}>
            {isOwner ? `From ${offer.requesterName}` : `With ${offer.listingOwnerName}`}
          </Text>
        </View>
        <StatusPill status={offer.status} />
      </View>
      <Text style={styles.cardBody}>Offer: {offer.offeredBooks}</Text>
      {offer.note ? <Text style={styles.tradeNote}>{offer.note}</Text> : null}

      {isOwner && offer.status === 'pending' && (
        <View style={styles.actionRow}>
          <PrimaryButton label="Accept" icon="checkmark" compact onPress={onAccept} />
          <SecondaryButton label="Decline" icon="close" compact onPress={onDecline} />
        </View>
      )}

      {isAccepted && (
        <>
          <View style={styles.chatBox}>
            {offer.messages.length === 0 ? (
              <Text style={styles.mutedText}>Chat opens after a trade is accepted.</Text>
            ) : (
              offer.messages.map((item) => (
                <View
                  key={item.id}
                  style={[
                    styles.messageBubble,
                    item.senderId === currentProfile.id && styles.messageBubbleOwn,
                  ]}
                >
                  <Text style={styles.messageName}>{item.senderName}</Text>
                  <Text style={styles.messageText}>{item.text}</Text>
                </View>
              ))
            )}
          </View>
          <View style={styles.messageComposer}>
            <TextInput
              value={message}
              onChangeText={setMessage}
              placeholder="Message"
              placeholderTextColor={colors.muted}
              style={styles.messageInput}
            />
            <IconButton
              icon="send"
              onPress={() => {
                onSend(message);
                setMessage('');
              }}
            />
          </View>
          <PrimaryButton label="Mark completed" icon="checkmark-done" onPress={onComplete} />
        </>
      )}

      {isCompleted && (
        <View style={styles.ratingRow}>
          {[1, 2, 3, 4, 5].map((rating) => (
            <Pressable key={rating} onPress={() => onRate(rating)} style={styles.starButton}>
              <Ionicons name="star" size={21} color={colors.brass} />
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

function Field({
  label,
  multiline,
  style,
  ...props
}: React.ComponentProps<typeof TextInput> & { label: string }) {
  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        placeholderTextColor={colors.muted}
        multiline={multiline}
        style={[styles.input, multiline && styles.textArea, style]}
        {...props}
      />
    </View>
  );
}

function PrimaryButton({
  label,
  icon,
  loading,
  compact,
  onPress,
}: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  loading?: boolean;
  compact?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={loading}
      style={({ pressed }) => [
        styles.primaryButton,
        compact && styles.compactButton,
        pressed && styles.pressed,
      ]}
    >
      {loading ? (
        <ActivityIndicator color="#FFFFFF" />
      ) : (
        <>
          <Ionicons name={icon} size={18} color="#FFFFFF" />
          <Text style={styles.primaryButtonText}>{label}</Text>
        </>
      )}
    </Pressable>
  );
}

function SecondaryButton({
  label,
  icon,
  loading,
  compact,
  onPress,
}: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  loading?: boolean;
  compact?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={loading}
      style={({ pressed }) => [
        styles.secondaryButton,
        compact && styles.compactButton,
        pressed && styles.pressed,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={colors.teal} />
      ) : (
        <>
          <Ionicons name={icon} size={18} color={colors.tealDark} />
          <Text style={styles.secondaryButtonText}>{label}</Text>
        </>
      )}
    </Pressable>
  );
}

function IconButton({
  icon,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}>
      <Ionicons name={icon} size={20} color={colors.ink} />
    </Pressable>
  );
}

function StatusPill({ status }: { status: string }) {
  return (
    <View style={[styles.statusPill, { borderColor: statusColor(status as OfferStatus) }]}>
      <Text style={[styles.statusText, { color: statusColor(status as OfferStatus) }]}>
        {readableStatus(status)}
      </Text>
    </View>
  );
}

function SegmentedControl({
  value,
  options,
  onChange,
}: {
  value: string;
  options: { label: string; value: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <View style={styles.segmented}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            style={[styles.segment, selected && styles.segmentSelected]}
          >
            <Text style={[styles.segmentText, selected && styles.segmentTextSelected]}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function EmptyState({ icon, title }: { icon: keyof typeof Ionicons.glyphMap; title: string }) {
  return (
    <View style={styles.emptyState}>
      <Ionicons name={icon} size={30} color={colors.teal} />
      <Text style={styles.emptyTitle}>{title}</Text>
    </View>
  );
}

function TabBar({
  activeTab,
  onChange,
}: {
  activeTab: TabKey;
  onChange: (tab: TabKey) => void;
}) {
  const tabs: { key: TabKey; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
    { key: 'market', label: 'Market', icon: 'storefront-outline' },
    { key: 'add', label: 'List', icon: 'add-circle-outline' },
    { key: 'trades', label: 'Trades', icon: 'swap-horizontal-outline' },
    { key: 'profile', label: 'Profile', icon: 'person-outline' },
  ];

  return (
    <View style={styles.tabBar}>
      {tabs.map((tab) => {
        const selected = activeTab === tab.key;
        return (
          <Pressable key={tab.key} onPress={() => onChange(tab.key)} style={styles.tabButton}>
            <Ionicons
              name={tab.icon}
              size={22}
              color={selected ? colors.teal : colors.muted}
            />
            <Text style={[styles.tabLabel, selected && styles.tabLabelSelected]}>{tab.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  center: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    color: colors.muted,
    marginTop: spacing.md,
  },
  appShell: {
    flex: 1,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: Platform.OS === 'android' ? spacing.lg : spacing.sm,
    paddingBottom: spacing.md,
  },
  brand: {
    color: colors.ink,
    fontSize: 24,
    fontWeight: '800',
  },
  brandLarge: {
    color: colors.ink,
    fontSize: 42,
    fontWeight: '900',
  },
  headerSubtext: {
    color: colors.muted,
    fontSize: 13,
    marginTop: 2,
  },
  avatar: {
    alignItems: 'center',
    backgroundColor: colors.teal,
    borderRadius: 20,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  avatarText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },
  screen: {
    flex: 1,
    paddingHorizontal: spacing.lg,
  },
  scrollContent: {
    paddingBottom: 120,
  },
  authWrap: {
    flex: 1,
    justifyContent: 'space-between',
    padding: spacing.lg,
  },
  authScroll: {
    flexGrow: 1,
    justifyContent: 'space-between',
    padding: spacing.lg,
    paddingBottom: spacing.xl,
  },
  authHero: {
    paddingTop: spacing.xl,
  },
  authHeadline: {
    color: colors.ink,
    fontSize: 25,
    fontWeight: '800',
    lineHeight: 32,
    marginTop: spacing.lg,
  },
  authSubtext: {
    color: colors.muted,
    fontSize: 15,
    lineHeight: 22,
    marginTop: spacing.md,
  },
  authPanel: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.md,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.08,
    shadowRadius: 18,
  },
  onboarding: {
    gap: spacing.md,
    padding: spacing.lg,
    paddingBottom: 80,
  },
  searchRow: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    height: 48,
    paddingHorizontal: spacing.md,
  },
  searchInput: {
    color: colors.ink,
    flex: 1,
    fontSize: 15,
  },
  band: {
    marginVertical: spacing.lg,
  },
  sectionHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
    marginTop: spacing.lg,
  },
  sectionTitle: {
    color: colors.ink,
    fontSize: 20,
    fontWeight: '800',
  },
  mutedText: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18,
  },
  listingCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.md,
    padding: spacing.sm,
  },
  compactCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    marginRight: spacing.md,
    padding: spacing.sm,
    width: 132,
  },
  coverLarge: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: radii.sm,
    height: 126,
    width: 82,
  },
  coverCompact: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: radii.sm,
    height: 118,
    width: '100%',
  },
  coverFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  listingContent: {
    flex: 1,
    minWidth: 0,
  },
  listingTitleRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
  },
  cardTitle: {
    color: colors.ink,
    flex: 1,
    fontSize: 16,
    fontWeight: '800',
  },
  cardSubtitle: {
    color: colors.muted,
    fontSize: 13,
    marginTop: 3,
  },
  cardBody: {
    color: colors.ink,
    fontSize: 13,
    lineHeight: 18,
    marginTop: spacing.sm,
  },
  metaRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4,
    marginTop: spacing.sm,
  },
  metaText: {
    color: colors.muted,
    flexShrink: 1,
    fontSize: 12,
  },
  dot: {
    color: colors.muted,
    fontSize: 14,
    marginHorizontal: 2,
  },
  tradeNote: {
    color: colors.tealDark,
    fontSize: 13,
    lineHeight: 18,
    marginTop: spacing.sm,
  },
  compactTitle: {
    color: colors.ink,
    fontSize: 14,
    fontWeight: '800',
    marginTop: spacing.sm,
    minHeight: 38,
  },
  statusPill: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '800',
  },
  photoGrid: {
    flexDirection: 'row',
    gap: spacing.md,
    marginVertical: spacing.md,
  },
  photoPicker: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    flex: 1,
    overflow: 'hidden',
  },
  photoPreview: {
    height: 180,
    width: '100%',
  },
  photoPlaceholder: {
    alignItems: 'center',
    height: 180,
    justifyContent: 'center',
  },
  photoLabel: {
    color: colors.ink,
    fontSize: 14,
    fontWeight: '800',
    marginTop: spacing.sm,
  },
  photoActions: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-around',
    padding: spacing.xs,
  },
  coverPreviewWrap: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    gap: spacing.sm,
    marginBottom: spacing.md,
    overflow: 'hidden',
    padding: spacing.md,
  },
  coverPreview: {
    aspectRatio: 0.7,
    borderRadius: radii.sm,
    width: '100%',
  },
  coverPreviewFallback: {
    alignItems: 'center',
    backgroundColor: colors.surfaceMuted,
    borderRadius: radii.sm,
    gap: spacing.sm,
    justifyContent: 'center',
    minHeight: 180,
    padding: spacing.lg,
  },
  actionRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginVertical: spacing.sm,
  },
  fieldWrap: {
    gap: spacing.xs,
    marginBottom: spacing.md,
  },
  label: {
    color: colors.ink,
    fontSize: 13,
    fontWeight: '800',
  },
  input: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    color: colors.ink,
    fontSize: 15,
    minHeight: 46,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  textArea: {
    minHeight: 96,
    textAlignVertical: 'top',
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: colors.teal,
    borderRadius: radii.md,
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: spacing.md,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800',
  },
  secondaryButton: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    flex: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: spacing.md,
  },
  secondaryButtonText: {
    color: colors.tealDark,
    fontSize: 15,
    fontWeight: '800',
  },
  compactButton: {
    flex: 1,
    minHeight: 42,
  },
  iconButton: {
    alignItems: 'center',
    backgroundColor: colors.surfaceMuted,
    borderRadius: radii.md,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  pressed: {
    opacity: 0.75,
  },
  segmented: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: radii.md,
    flexDirection: 'row',
    gap: 4,
    marginBottom: spacing.md,
    padding: 4,
  },
  segment: {
    alignItems: 'center',
    borderRadius: radii.sm,
    flex: 1,
    minHeight: 38,
    justifyContent: 'center',
  },
  segmentSelected: {
    backgroundColor: colors.surface,
  },
  segmentText: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: '800',
  },
  segmentTextSelected: {
    color: colors.ink,
  },
  demoLink: {
    alignItems: 'center',
    paddingVertical: spacing.xs,
  },
  demoLinkText: {
    color: colors.tealDark,
    fontSize: 13,
    fontWeight: '800',
  },
  emptyState: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: radii.md,
    borderStyle: 'dashed',
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.xl,
  },
  emptyTitle: {
    color: colors.ink,
    fontSize: 16,
    fontWeight: '800',
  },
  modalBackdrop: {
    backgroundColor: 'rgba(9, 18, 15, 0.38)',
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: spacing.lg,
  },
  modalHeader: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.lg,
  },
  tradeCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    gap: spacing.sm,
    marginBottom: spacing.md,
    padding: spacing.md,
  },
  flexOne: {
    flex: 1,
  },
  chatBox: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: radii.md,
    gap: spacing.sm,
    padding: spacing.sm,
  },
  messageBubble: {
    alignSelf: 'flex-start',
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    maxWidth: '86%',
    padding: spacing.sm,
  },
  messageBubbleOwn: {
    alignSelf: 'flex-end',
    backgroundColor: '#DDEDEA',
  },
  messageName: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: '800',
    marginBottom: 2,
  },
  messageText: {
    color: colors.ink,
    fontSize: 13,
    lineHeight: 18,
  },
  messageComposer: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  messageInput: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: radii.md,
    color: colors.ink,
    flex: 1,
    minHeight: 42,
    paddingHorizontal: spacing.md,
  },
  ratingRow: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  starButton: {
    padding: spacing.xs,
  },
  mutualMatchBadge: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: '#DDEDEA',
    borderRadius: 999,
    flexDirection: 'row',
    gap: 4,
    marginTop: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  mutualMatchText: {
    color: colors.teal,
    fontSize: 11,
    fontWeight: '800',
  },
  offerPicker: {
    marginBottom: spacing.md,
  },
  offerBookCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    marginRight: spacing.sm,
    padding: spacing.sm,
    width: 120,
  },
  offerBookCardSelected: {
    backgroundColor: '#DDEDEA',
    borderColor: colors.teal,
    borderWidth: 2,
  },
  offerBookTitle: {
    color: colors.ink,
    fontSize: 13,
    fontWeight: '800',
    marginTop: spacing.xs,
    minHeight: 34,
  },
  emptyOfferHint: {
    alignItems: 'center',
    backgroundColor: colors.surfaceMuted,
    borderRadius: radii.md,
    gap: spacing.sm,
    justifyContent: 'center',
    marginBottom: spacing.md,
    padding: spacing.lg,
  },
  profileSummary: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  avatarLarge: {
    alignItems: 'center',
    backgroundColor: colors.wine,
    borderRadius: 32,
    height: 64,
    justifyContent: 'center',
    width: 64,
  },
  avatarLargeText: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '900',
  },
  profileSummaryText: {
    flex: 1,
  },
  inlineRating: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  tabBar: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderTopColor: colors.border,
    borderTopWidth: 1,
    bottom: 0,
    flexDirection: 'row',
    height: 76,
    justifyContent: 'space-around',
    left: 0,
    paddingBottom: Platform.OS === 'ios' ? spacing.md : spacing.sm,
    position: 'absolute',
    right: 0,
  },
  tabButton: {
    alignItems: 'center',
    gap: 4,
    minWidth: 62,
  },
  tabLabel: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: '800',
  },
  tabLabelSelected: {
    color: colors.teal,
  },
});
