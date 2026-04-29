import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import * as FileSystem from 'expo-file-system/legacy';
import { GoogleSignin, statusCodes } from '@react-native-google-signin/google-signin';
import * as IntentLauncher from 'expo-intent-launcher';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  AppStateStatus,
  Image,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar as RNStatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  GoogleAuthProvider,
  User,
  createUserWithEmailAndPassword,
  getAdditionalUserInfo,
  onAuthStateChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
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

GoogleSignin.configure({
  webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
  offlineAccess: false,
});

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
const CURRENT_BUILD = parseInt(process.env.EXPO_PUBLIC_BUILD_NUMBER ?? '0', 10);
const GITHUB_REPO = 'CodingGenius0001/booktrader';
const LAST_OFFERS_KEY = '@bt_last_offers';
type OfferSnap = { id: string; status: string; msgCount: number };

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

async function requestCoordinates(): Promise<{ latitude: number; longitude: number } | null> {
  try {
    const permission = await Location.requestForegroundPermissionsAsync();
    if (permission.status !== 'granted') return null;

    const position = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 8000)),
    ]);

    if (!position) return null;
    return { latitude: position.coords.latitude, longitude: position.coords.longitude };
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
    coverImageUrl: value.coverImageUrl
      ? String(value.coverImageUrl).replace(/^http:\/\//, 'https://')
      : null,
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
    ratedBy: (value.ratedBy as string[] | undefined) ?? [],
  };
}

export default function App() {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(hasFirebaseConfig);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [demoProfile, setDemoProfile] = useState<UserProfile>(demoUser);
  const [demoMode, setDemoMode] = useState(!hasFirebaseConfig);
  const [listings, setListings] = useState<BookListing[]>(hasFirebaseConfig ? [] : demoListings);
  const [offers, setOffers] = useState<TradeOffer[]>(hasFirebaseConfig ? [] : demoOffers);
  const [activeTab, setActiveTab] = useState<TabKey>('market');
  const [busy, setBusy] = useState(false);
  const [pendingUpdate, setPendingUpdate] = useState<{ build: number; apkUrl: string } | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  const [updateChecking, setUpdateChecking] = useState(false);
  const [upToDate, setUpToDate] = useState(false);

  const updateChecked = useRef(false);
  const prevOffersRef = useRef<TradeOffer[]>([]);
  const savedOffersRef = useRef<OfferSnap[] | null>(null);
  const savedOffersLoaded = useRef(false);
  const lastUpdateCheckRef = useRef(0);


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

    const db = firebase.db;
    // Two separate queries to satisfy Firestore security rules (which restrict reads
    // to participants only — a single unfiltered collection query would be rejected).
    const incoming: TradeOffer[] = [];
    const outgoing: TradeOffer[] = [];

    function mergeAndNotify(updated: TradeOffer[], bucket: 'in' | 'out') {
      if (bucket === 'in') incoming.splice(0, incoming.length, ...updated);
      else outgoing.splice(0, outgoing.length, ...updated);

      const merged = [...incoming];
      outgoing.forEach((o) => {
        if (!merged.find((m) => m.id === o.id)) merged.push(o);
      });
      merged.sort((a, b) => b.updatedAt - a.updatedAt);

      // Fire local notifications for status / message changes.
      // On first load (prev is empty), fall back to the AsyncStorage snapshot saved
      // on the previous session so we catch changes that happened while the app was closed.
      const prev = prevOffersRef.current;
      const isFirstLoad = prev.length === 0 && savedOffersLoaded.current && savedOffersRef.current !== null;
      if (prev.length > 0 || isFirstLoad) {
        merged.forEach((next) => {
          if (isFirstLoad) {
            // Compare against the lightweight AsyncStorage snapshot (status + message count only)
            const snap = savedOffersRef.current!.find((s) => s.id === next.id);
            if (!snap) {
              if (next.listingOwnerId === currentUserId) {
                fireLocalNotification('New trade request', `${next.requesterName} wants to trade for "${next.listingTitle}"`);
              }
            } else if (snap.status !== next.status) {
              if (next.status === 'accepted' && next.requesterId === currentUserId) {
                fireLocalNotification('Trade accepted!', `${next.listingOwnerName} accepted your offer for "${next.listingTitle}"`);
              } else if (next.status === 'declined' && next.requesterId === currentUserId) {
                fireLocalNotification('Trade declined', `Your offer for "${next.listingTitle}" was declined.`);
              } else if (next.status === 'completed') {
                fireLocalNotification('Trade complete!', `"${next.listingTitle}" — tap to leave a rating.`);
              }
            } else if ((next.messages?.length ?? 0) > snap.msgCount) {
              const last = next.messages[next.messages.length - 1];
              if (last && last.senderId !== currentUserId) {
                fireLocalNotification(`${last.senderName}`, last.text);
              }
            }
          } else {
            const old = prev.find((o) => o.id === next.id);
            if (!old) {
              if (next.listingOwnerId === currentUserId) {
                fireLocalNotification('New trade request', `${next.requesterName} wants to trade for "${next.listingTitle}"`);
              }
            } else if (old.status !== next.status) {
              if (next.status === 'accepted' && next.requesterId === currentUserId) {
                fireLocalNotification('Trade accepted!', `${next.listingOwnerName} accepted your offer for "${next.listingTitle}"`);
              } else if (next.status === 'declined' && next.requesterId === currentUserId) {
                fireLocalNotification('Trade declined', `Your offer for "${next.listingTitle}" was declined.`);
              } else if (next.status === 'completed') {
                fireLocalNotification('Trade complete!', `"${next.listingTitle}" — tap to leave a rating.`);
              }
            } else if ((next.messages?.length ?? 0) > (old.messages?.length ?? 0)) {
              const last = next.messages[next.messages.length - 1];
              if (last && last.senderId !== currentUserId) {
                fireLocalNotification(`${last.senderName}`, last.text);
              }
            }
          }
        });
        // After first-load comparison, clear saved snapshot so it doesn't re-fire
        if (isFirstLoad) savedOffersRef.current = null;
      }
      prevOffersRef.current = merged;
      setOffers(merged);
    }

    const unsubIn = onSnapshot(
      query(collection(db, 'tradeOffers'), where('listingOwnerId', '==', currentUserId), orderBy('updatedAt', 'desc')),
      (snap) => mergeAndNotify(snap.docs.map((d) => mapOffer(d.id, d.data())), 'in'),
    );
    const unsubOut = onSnapshot(
      query(collection(db, 'tradeOffers'), where('requesterId', '==', currentUserId), orderBy('updatedAt', 'desc')),
      (snap) => mergeAndNotify(snap.docs.map((d) => mapOffer(d.id, d.data())), 'out'),
    );

    return () => {
      unsubIn();
      unsubOut();
    };
  }, [currentUserId, demoMode]);


  useEffect(() => {
    if (!currentUserId || demoMode) return;
    Notifications.requestPermissionsAsync().catch(() => undefined);
    registerPushToken(currentUserId).catch(() => undefined);
  }, [currentUserId, demoMode]);

  // Silently refresh coordinates in the background when profile has none.
  // Runs once per session after profile loads.
  useEffect(() => {
    if (!currentProfile || currentProfile.coordinates || demoMode || !firebase.db) return;
    requestCoordinates().then((coords) => {
      if (!coords || !firebase.db) return;
      setDoc(
        doc(firebase.db, 'users', currentProfile.id),
        { coordinates: coords, updatedAt: now() },
        { merge: true },
      ).catch(() => undefined);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentProfile?.id]);

  // Auto-check once per session on startup
  useEffect(() => {
    if (!currentProfile || updateChecked.current || Platform.OS !== 'android' || CURRENT_BUILD === 0) {
      return;
    }
    updateChecked.current = true;
    lastUpdateCheckRef.current = Date.now();
    checkForUpdates();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentProfile?.id]);

  // Load last-seen offer snapshot from AsyncStorage so we can detect changes
  // that happened while the app was closed (and fire notifications on next open).
  useEffect(() => {
    AsyncStorage.getItem(LAST_OFFERS_KEY)
      .then((raw) => {
        if (raw) savedOffersRef.current = JSON.parse(raw) as OfferSnap[];
      })
      .catch(() => undefined)
      .finally(() => { savedOffersLoaded.current = true; });
  }, []);

  // AppState listener: save offer snapshot on background; re-check updates on foreground.
  useEffect(() => {
    const handleAppStateChange = (nextState: AppStateStatus) => {
      if (nextState === 'active') {
        // Re-check for updates at most once per 10 minutes when foregrounding.
        if (Platform.OS === 'android' && CURRENT_BUILD > 0) {
          const elapsed = Date.now() - lastUpdateCheckRef.current;
          if (elapsed > 10 * 60 * 1000) {
            lastUpdateCheckRef.current = Date.now();
            checkForUpdates();
          }
        }
      } else if (nextState === 'background' || nextState === 'inactive') {
        // Persist current offers so we can detect changes on next open.
        const snap: OfferSnap[] = prevOffersRef.current.map((o) => ({
          id: o.id,
          status: o.status,
          msgCount: o.messages?.length ?? 0,
        }));
        if (snap.length > 0) {
          AsyncStorage.setItem(LAST_OFFERS_KEY, JSON.stringify(snap)).catch(() => undefined);
        }
      }
    };
    const sub = AppState.addEventListener('change', handleAppStateChange);
    return () => sub.remove();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

        // Send verification email IMMEDIATELY — before requestCoordinates()
        // which can block for 30-60 s waiting for a GPS fix on Android.
        try {
          await sendEmailVerification(created.user, {
            url: `https://${process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN ?? ''}`,
            handleCodeInApp: false,
          });
        } catch (verifyErr) {
          Alert.alert(
            'Account created but verification email failed',
            verifyErr instanceof Error ? verifyErr.message : 'Use the resend button on the next screen.',
          );
        }

        // Location request happens after email is already sent.
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

  async function handleGoogleSignIn() {
    if (!firebase.auth || !firebase.db) {
      Alert.alert('Firebase is not configured', 'Add your Firebase values to .env first.');
      return;
    }
    try {
      setBusy(true);
      await GoogleSignin.hasPlayServices();
      await GoogleSignin.signIn();
      const { idToken } = await GoogleSignin.getTokens();
      if (!idToken) {
        throw new Error('Google did not return an ID token.');
      }
      const credential = GoogleAuthProvider.credential(idToken);
      const db = firebase.db;
      const result = await signInWithCredential(firebase.auth, credential);
      const info = getAdditionalUserInfo(result);
      if (info?.isNewUser) {
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
    } catch (error: unknown) {
      if (error && typeof error === 'object' && 'code' in error) {
        const code = (error as { code: string }).code;
        if (code === statusCodes.SIGN_IN_CANCELLED || code === statusCodes.IN_PROGRESS) return;
      }
      Alert.alert('Google sign-in failed', error instanceof Error ? error.message : 'Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function checkForUpdates() {
    if (Platform.OS !== 'android' || CURRENT_BUILD === 0) return;
    setUpdateChecking(true);
    setUpToDate(false);
    try {
      const res = await fetch(
        `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`,
        { headers: { Accept: 'application/vnd.github+json' } },
      );
      if (!res.ok) return;
      const data: { tag_name?: string } = await res.json();
      if (!data.tag_name) return;
      const latestBuild = parseInt(data.tag_name.replace('build-', ''), 10);
      if (!isNaN(latestBuild) && latestBuild > CURRENT_BUILD) {
        const apkUrl = `https://github.com/${GITHUB_REPO}/releases/latest/download/booktrader.apk`;
        setPendingUpdate({ build: latestBuild, apkUrl });
        setUpToDate(false);
      } else {
        setPendingUpdate(null);
        setUpToDate(true);
      }
    } catch {
      // network error — leave existing state
    } finally {
      setUpdateChecking(false);
    }
  }

  function fireLocalNotification(title: string, body: string) {
    Notifications.scheduleNotificationAsync({
      content: { title, body, sound: true },
      trigger: null,
    }).catch(() => undefined);
  }

  async function downloadAndInstall() {
    if (!pendingUpdate) return;
    try {
      setDownloadProgress(0);
      const dest = (FileSystem.cacheDirectory ?? '') + 'booktrader-update.apk';
      const dl = FileSystem.createDownloadResumable(
        pendingUpdate.apkUrl,
        dest,
        {},
        ({ totalBytesWritten, totalBytesExpectedToWrite }) => {
          setDownloadProgress(
            totalBytesExpectedToWrite > 0 ? totalBytesWritten / totalBytesExpectedToWrite : 0,
          );
        },
      );
      const result = await dl.downloadAsync();
      if (!result?.uri) throw new Error('Download failed');
      const contentUri = await FileSystem.getContentUriAsync(result.uri);
      await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
        data: contentUri,
        flags: 1,
        type: 'application/vnd.android.package-archive',
      });
      setDownloadProgress(null);
      setPendingUpdate(null);
    } catch {
      setDownloadProgress(null);
      Alert.alert('Download failed', 'Could not download the update. Try again later.');
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

      // Always get fresh coordinates at publish time so listings are accurate
      // even if profile coordinates were null from a registration GPS timeout.
      const freshCoords = await requestCoordinates();
      const ownerCoordinates = freshCoords ?? currentProfile.coordinates ?? null;

      // Persist fresh coords back to profile so future distance calcs work
      if (freshCoords && !demoMode && firebase.db) {
        setDoc(
          doc(firebase.db, 'users', currentProfile.id),
          { coordinates: freshCoords, updatedAt: now() },
          { merge: true },
        ).catch(() => undefined);
      }

      const listing: BookListing = {
        ...input.draft,
        id: listingId,
        ownerId: currentProfile.id,
        ownerName: currentProfile.legalName,
        ownerCity: currentProfile.city,
        ownerCommunity: currentProfile.community,
        ownerCoordinates,
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

  async function editListing(listingId: string, patch: Partial<Pick<BookListing, 'title' | 'author' | 'edition' | 'description' | 'wants'>>) {
    if (demoMode || !firebase.db) {
      setListings((cur) => cur.map((l) => (l.id === listingId ? { ...l, ...patch } : l)));
      return;
    }
    await updateDoc(doc(firebase.db, 'listings', listingId), { ...patch, updatedAt: now() });
  }

  async function deleteListing(listingId: string) {
    if (demoMode || !firebase.db) {
      setListings((cur) => cur.filter((l) => l.id !== listingId));
      return;
    }
    const { deleteDoc } = await import('firebase/firestore');
    await deleteDoc(doc(firebase.db, 'listings', listingId));
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
      ratedBy: [],
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

    try {
      if (status === 'accepted') {
        const batch = writeBatch(db);
        batch.update(doc(db, 'tradeOffers', offer.id), { status: 'accepted', updatedAt });
        batch.update(doc(db, 'listings', offer.listingId), {
          status: 'claimed',
          claimedBy: offer.requesterId,
        });

        // Must include listingOwnerId filter so Firestore security rules can verify access.
        const otherOffers = await getDocs(
          query(
            collection(db, 'tradeOffers'),
            where('listingId', '==', offer.listingId),
            where('listingOwnerId', '==', offer.listingOwnerId),
          ),
        );

        otherOffers.docs.forEach((item) => {
          if (item.id !== offer.id) {
            batch.update(doc(db, 'tradeOffers', item.id), { status: 'declined', updatedAt });
          }
        });

        await batch.commit();
        return;
      }

      await updateDoc(doc(db, 'tradeOffers', offer.id), { status, updatedAt });

      if (status === 'completed') {
        await updateDoc(doc(db, 'listings', offer.listingId), { status: 'completed' });
      }
    } catch (error) {
      Alert.alert(
        'Action failed',
        error instanceof Error ? error.message : 'Could not update the trade. Try again.',
      );
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

  async function rateTrade(offer: TradeOffer, rating: number, reviewText: string) {
    if (!currentProfile) return;
    const ratedUserId =
      offer.requesterId === currentProfile.id ? offer.listingOwnerId : offer.requesterId;

    if (demoMode || !firebase.db) {
      Alert.alert('Rating saved', `${rating} star rating recorded.`);
      return;
    }

    const db = firebase.db;
    // Save rating document
    await addDoc(collection(db, 'ratings'), {
      offerId: offer.id,
      fromUserId: currentProfile.id,
      toUserId: ratedUserId,
      rating,
      review: reviewText.trim(),
      createdAt: now(),
    });

    // Mark this user as having rated on the offer so the stars don't reappear
    await updateDoc(doc(db, 'tradeOffers', offer.id), {
      ratedBy: [...(offer.ratedBy ?? []), currentProfile.id],
    });

    // Recompute rated user's aggregate
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

    Alert.alert('Rating saved', `${rating}★ rating submitted. Thank you!`);
  }

  async function handleSignOut() {
    if (demoMode) {
      setDemoMode(false);
      setProfile(null);
      setActiveTab('market');
      return;
    }
    // Clear Google native session so account picker appears next login
    GoogleSignin.signOut().catch(() => undefined);
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
        onGoogle={handleGoogleSignIn}
      />
    );
  }

  // Block email/password accounts that haven't verified their email yet.
  // Google accounts are pre-verified by Google.
  const isEmailProvider = firebaseUser?.providerData.some((p) => p.providerId === 'password');
  if (!demoMode && firebaseUser && isEmailProvider && !firebaseUser.emailVerified) {
    return (
      <EmailVerificationGate
        email={firebaseUser.email ?? ''}
        onResend={async () => {
          try {
            await sendEmailVerification(firebaseUser, {
              url: `https://${process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN ?? ''}`,
              handleCodeInApp: false,
            });
            Alert.alert(
              'Email sent',
              `Sent to ${firebaseUser.email}.\n\nCheck your spam / junk folder and search for: noreply@`,
            );
          } catch (e) {
            Alert.alert(
              'Could not send email',
              e instanceof Error ? e.message : 'Try again later.',
            );
          }
        }}
        onRefresh={async () => {
          await firebaseUser.reload();
          if (firebaseUser.emailVerified) {
            setFirebaseUser({ ...firebaseUser } as User);
          } else {
            Alert.alert('Not verified yet', 'Click the link in the email we sent you.');
          }
        }}
        onSignOut={handleSignOut}
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

  const pendingIncoming = offers.filter(
    (o) => o.listingOwnerId === currentProfile.id && o.status === 'pending',
  ).length;

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />
      <View style={styles.appShell}>
        <Header
          profile={currentProfile}
          demoMode={demoMode || !hasFirebaseConfig}
          onProfilePress={() => setActiveTab('profile')}
        />
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
            onEditListing={editListing}
            onDeleteListing={deleteListing}
            updateChecking={updateChecking}
            upToDate={upToDate}
            pendingUpdate={pendingUpdate}
            downloadProgress={downloadProgress}
            onCheckUpdate={checkForUpdates}
            onInstallUpdate={downloadAndInstall}
            onPhotoChange={async (photoUrl) => {
              const userId = firebaseUser?.uid ?? demoProfile.id;
              await saveProfile(userId, {
                legalName: currentProfile.legalName,
                email: currentProfile.email,
                city: currentProfile.city,
                community: currentProfile.community,
                coordinates: currentProfile.coordinates,
                wishlist: currentProfile.wishlist,
                photoUrl,
              });
            }}
            onSignOut={handleSignOut}
          />
        )}
      </View>
      <TabBar activeTab={activeTab} onChange={setActiveTab} badge={pendingIncoming} />
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

function EmailVerificationGate({
  email,
  onResend,
  onRefresh,
  onSignOut,
}: {
  email: string;
  onResend: () => Promise<void>;
  onRefresh: () => Promise<void>;
  onSignOut: () => void;
}) {
  const [busy, setBusy] = useState(false);

  async function wrap(fn: () => Promise<void>) {
    setBusy(true);
    try { await fn(); } finally { setBusy(false); }
  }

  return (
    <SafeAreaView style={[styles.safeArea, styles.center]}>
      <StatusBar style="light" />
      <View style={styles.verifyCard}>
        <Ionicons name="mail-unread-outline" size={48} color={colors.teal} />
        <Text style={styles.verifyTitle}>Verify your email</Text>
        <Text style={styles.verifyBody}>
          We sent a verification link to{'\n'}
          <Text style={{ color: colors.ink, fontWeight: '800' }}>{email}</Text>
          {'\n\n'}Click the link in that email, then tap the button below.
        </Text>
        <PrimaryButton
          label="I've verified — continue"
          icon="checkmark-circle-outline"
          loading={busy}
          onPress={() => wrap(onRefresh)}
        />
        <SecondaryButton
          label="Resend verification email"
          icon="send-outline"
          loading={busy}
          onPress={() => wrap(onResend)}
        />
        <Pressable onPress={onSignOut} style={{ marginTop: spacing.sm }}>
          <Text style={styles.mutedText}>Use a different account</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

function Avatar({ name, photoUrl, size }: { name: string; photoUrl?: string | null; size: 'sm' | 'lg' }) {
  const initials = name.split(' ').filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase();
  const dim = size === 'sm' ? 40 : 64;
  const fontSize = size === 'sm' ? 14 : 22;
  const radius = dim / 2;

  if (photoUrl) {
    return (
      <Image
        source={{ uri: photoUrl }}
        style={{ width: dim, height: dim, borderRadius: radius, backgroundColor: colors.surfaceMuted }}
      />
    );
  }
  return (
    <View style={{ width: dim, height: dim, borderRadius: radius, backgroundColor: size === 'lg' ? colors.wine : colors.teal, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: '#FFFFFF', fontSize, fontWeight: '900' }}>{initials}</Text>
    </View>
  );
}

function Header({
  profile,
  demoMode,
  onProfilePress,
}: {
  profile: UserProfile;
  demoMode: boolean;
  onProfilePress: () => void;
}) {
  return (
    <View style={styles.header}>
      <View>
        <Text style={styles.brand}>BookTrader</Text>
        <Text style={styles.headerSubtext}>
          {profile.community} {demoMode ? '· Demo' : ''}
        </Text>
      </View>
      <Pressable onPress={onProfilePress} style={({ pressed }) => pressed && styles.pressed}>
        <Avatar name={profile.legalName} photoUrl={profile.photoUrl} size="sm" />
      </Pressable>
    </View>
  );
}

function AuthScreen({
  busy,
  onEmailAuth,
  onGoogle,
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
}) {
  const [mode, setMode] = useState<AuthMode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [legalName, setLegalName] = useState('');
  const [city, setCity] = useState(DEFAULT_CITY);
  const [community, setCommunity] = useState(DEFAULT_COMMUNITY);

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />
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
            {mode === 'login' && (
              <Pressable
                onPress={() => {
                  if (!email.trim()) {
                    Alert.alert('Enter your email first', 'Type your email above then tap forgot password.');
                    return;
                  }
                  if (!firebase.auth) return;
                  sendPasswordResetEmail(firebase.auth, email.trim())
                    .then(() => Alert.alert(
                      'Reset email sent',
                      `Check ${email.trim()} for a password reset link.\n\nIf it doesn't arrive, check your spam folder.`,
                    ))
                    .catch((e: Error) => Alert.alert('Error', e.message));
                }}
                style={styles.forgotLink}
              >
                <Text style={styles.forgotLinkText}>Forgot password?</Text>
              </Pressable>
            )}
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
      <StatusBar style="light" />
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

  async function runLookup(query: string, showError = false) {
    try {
      const next = await onGoogleLookup(query);
      setDraft((current) => ({
        ...current,
        ...next,
        title: current.title,
      }));
    } catch (err) {
      if (showError) {
        Alert.alert(
          'Google Books lookup failed',
          err instanceof Error ? err.message : 'Check your internet connection and try again.',
        );
      }
    }
  }

  useEffect(() => {
    if (lookupTimer.current) {
      clearTimeout(lookupTimer.current);
    }

    const title = draft.title.trim();

    if (title.length < 2) {
      return;
    }

    let cancelled = false;
    lookupTimer.current = setTimeout(() => {
      setAutofilling(true);
      // Silent on auto-lookup — user is still typing, an alert would be jarring.
      runLookup(title, false).finally(() => {
        if (!cancelled) setAutofilling(false);
      });
    }, 800);

    return () => {
      cancelled = true;
      if (lookupTimer.current) clearTimeout(lookupTimer.current);
    };
  // onGoogleLookup is a stable module-level function; omit to avoid spurious re-runs.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.title]);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.scrollContent}>
      <Text style={styles.sectionTitle}>New Listing</Text>
      <SecondaryButton
        label={autofilling ? 'Searching Google Books…' : (draft.author ? 'Search Google Books again' : 'Search Google Books')}
        icon="search-outline"
        loading={autofilling}
        onPress={() => {
          if (!draft.title.trim()) {
            Alert.alert('Title required', 'Enter a book title first, then tap to search.');
            return;
          }
          setAutofilling(true);
          // showError=true on manual press so the user knows what went wrong.
          runLookup(draft.title, true).finally(() => setAutofilling(false));
        }}
      />
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
  onRate: (offer: TradeOffer, rating: number, review: string) => void;
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
              onRate={(rating, review) => onRate(offer, rating, review)}
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
  onEditListing,
  onDeleteListing,
  onPhotoChange,
  onSignOut,
  updateChecking,
  upToDate,
  pendingUpdate,
  downloadProgress,
  onCheckUpdate,
  onInstallUpdate,
}: {
  profile: UserProfile;
  listings: BookListing[];
  onSave: (values: { legalName: string; city: string; community: string; wishlist: string[] }) => void;
  onEditListing: (id: string, patch: Partial<Pick<BookListing, 'title' | 'author' | 'edition' | 'description' | 'wants'>>) => void;
  onDeleteListing: (id: string) => void;
  onPhotoChange: (photoUrl: string) => Promise<void>;
  onSignOut: () => void;
  updateChecking: boolean;
  upToDate: boolean;
  pendingUpdate: { build: number; apkUrl: string } | null;
  downloadProgress: number | null;
  onCheckUpdate: () => void;
  onInstallUpdate: () => void;
}) {
  const [legalName, setLegalName] = useState(profile.legalName);
  const [city, setCity] = useState(profile.city);
  const [community, setCommunity] = useState(profile.community);
  const [wishlistText, setWishlistText] = useState(profile.wishlist.join(', '));
  const [editingListing, setEditingListing] = useState<BookListing | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const ownListings = listings.filter((listing) => listing.ownerId === profile.id);

  async function pickPhoto() {
    const ImagePicker = await import('expo-image-picker');
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert('Permission needed', 'Allow photo library access to set a profile picture.'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.7,
      base64: false,
    });
    if (result.canceled || !result.assets[0]) return;
    setUploadingPhoto(true);
    try {
      await onPhotoChange(result.assets[0].uri);
    } finally {
      setUploadingPhoto(false);
    }
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.scrollContent}>
      <View style={styles.profileSummary}>
        <Pressable onPress={pickPhoto} style={{ position: 'relative' }}>
          <Avatar name={profile.legalName} photoUrl={profile.photoUrl} size="lg" />
          <View style={styles.photoEditBadge}>
            {uploadingPhoto
              ? <ActivityIndicator size="small" color="#fff" />
              : <Ionicons name="camera" size={14} color="#fff" />}
          </View>
        </Pressable>
        <View style={styles.profileSummaryText}>
          <Text style={styles.sectionTitle}>{profile.legalName}</Text>
          <Text style={styles.mutedText}>{profile.city}</Text>
          <View style={styles.inlineRating}>
            <Ionicons name="star" color={colors.brass} size={16} />
            <Text style={styles.mutedText}>
              {(profile.ratingAverage ?? 0).toFixed(1)} ({profile.ratingCount ?? 0} ratings)
            </Text>
          </View>
        </View>
      </View>
      <Field label="Legal name" value={legalName} onChangeText={setLegalName} />
      <Field label="City" value={city} onChangeText={setCity} />
      <Field label="Community" value={community} onChangeText={setCommunity} />
      <Field label="Wishlist" value={wishlistText} onChangeText={setWishlistText} multiline />
      <PrimaryButton
        label="Save profile"
        icon="save-outline"
        onPress={() =>
          onSave({
            legalName,
            city,
            community,
            wishlist: wishlistText.split(',').map((i) => i.trim()).filter(Boolean),
          })
        }
      />
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Your Listings</Text>
        <Text style={styles.mutedText}>{ownListings.length}</Text>
      </View>
      {ownListings.map((listing) => (
        <View key={listing.id}>
          <ListingCard
            listing={listing}
            personalStatus={listing.status}
            distance={formatDaysLeft(listing.expiresAt)}
          />
          {listing.status === 'open' && (
            <View style={[styles.actionRow, { marginTop: -spacing.sm, marginBottom: spacing.md }]}>
              <SecondaryButton
                label="Edit"
                icon="create-outline"
                compact
                onPress={() => setEditingListing(listing)}
              />
              <SecondaryButton
                label="Delete"
                icon="trash-outline"
                compact
                onPress={() =>
                  Alert.alert('Delete listing?', 'This cannot be undone.', [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Delete', style: 'destructive', onPress: () => onDeleteListing(listing.id) },
                  ])
                }
              />
            </View>
          )}
        </View>
      ))}
      {/* ── Updates ── */}
      <View style={styles.updatesCard}>
        <View style={styles.updatesHeader}>
          <Ionicons name="cloud-download-outline" size={18} color={colors.teal} />
          <Text style={styles.updatesTitle}>Updates</Text>
          <Text style={styles.updatesBuild}>
            v0.1.0{CURRENT_BUILD > 0 ? ` · build ${CURRENT_BUILD}` : ''}
          </Text>
        </View>

        {downloadProgress !== null ? (
          <View style={{ gap: spacing.xs }}>
            <Text style={styles.mutedText}>Downloading… {Math.round(downloadProgress * 100)}%</Text>
            <View style={styles.updateProgressBar}>
              <View style={[styles.updateProgressFill, { width: `${Math.round(downloadProgress * 100)}%` as unknown as number }]} />
            </View>
          </View>
        ) : (
          <View style={{ gap: spacing.sm }}>
            {pendingUpdate ? (
              <View style={{ gap: spacing.sm }}>
                <Text style={styles.mutedText}>Build {pendingUpdate.build} is available</Text>
                <PrimaryButton label="Install update now" icon="download-outline" onPress={onInstallUpdate} />
              </View>
            ) : upToDate ? (
              <View style={styles.upToDateRow}>
                <Ionicons name="checkmark-circle" size={16} color={colors.success} />
                <Text style={[styles.mutedText, { color: colors.success }]}>You're on the latest version</Text>
              </View>
            ) : null}
            <SecondaryButton
              label={updateChecking ? 'Checking…' : (upToDate || pendingUpdate ? 'Check again' : 'Check for updates')}
              icon={updateChecking ? 'sync-outline' : 'refresh-outline'}
              loading={updateChecking}
              onPress={onCheckUpdate}
            />
          </View>
        )}
      </View>

      <SecondaryButton label="Sign out" icon="log-out-outline" onPress={onSignOut} />
      <Text style={styles.buildLabel}>
        v0.1.0{CURRENT_BUILD > 0 ? ` · build ${CURRENT_BUILD}` : ''}
      </Text>

      <EditListingModal
        listing={editingListing}
        onClose={() => setEditingListing(null)}
        onSave={(patch) => {
          if (editingListing) onEditListing(editingListing.id, patch);
          setEditingListing(null);
        }}
      />
    </ScrollView>
  );
}

function EditListingModal({
  listing,
  onClose,
  onSave,
}: {
  listing: BookListing | null;
  onClose: () => void;
  onSave: (patch: Partial<Pick<BookListing, 'title' | 'author' | 'edition' | 'description' | 'wants'>>) => void;
}) {
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [edition, setEdition] = useState('');
  const [description, setDescription] = useState('');
  const [wants, setWants] = useState('');

  useEffect(() => {
    if (listing) {
      setTitle(listing.title);
      setAuthor(listing.author);
      setEdition(listing.edition);
      setDescription(listing.description);
      setWants(listing.wants);
    }
  }, [listing]);

  return (
    <Modal transparent visible={Boolean(listing)} animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flexOne}>
          <View style={[styles.modalSheet, { maxHeight: '90%' }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.sectionTitle}>Edit listing</Text>
              <IconButton icon="close" onPress={onClose} />
            </View>
            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              <Field label="Title" value={title} onChangeText={setTitle} />
              <Field label="Author" value={author} onChangeText={setAuthor} />
              <Field label="Edition / Year" value={edition} onChangeText={setEdition} />
              <Field label="Description" value={description} onChangeText={setDescription} multiline />
              <Field label="What you want in return" value={wants} onChangeText={setWants} multiline />
              <PrimaryButton
                label="Save changes"
                icon="save-outline"
                onPress={() => {
                  if (!title.trim()) {
                    Alert.alert('Title required', 'Enter a book title.');
                    return;
                  }
                  onSave({ title: title.trim(), author: author.trim(), edition: edition.trim(), description: description.trim(), wants: wants.trim() });
                }}
              />
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
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
  onRate: (rating: number, review: string) => void;
}) {
  const [message, setMessage] = useState('');
  const [review, setReview] = useState('');
  const chatRef = useRef<ScrollView>(null);
  const isOwner = offer.listingOwnerId === currentProfile.id;
  const isAccepted = offer.status === 'accepted';
  const isCompleted = offer.status === 'completed';

  useEffect(() => {
    if (isAccepted) {
      setTimeout(() => chatRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [offer.messages.length, isAccepted]);

  function confirmAccept() {
    Alert.alert('Accept trade?', `Offer: ${offer.offeredBooks}`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Accept', onPress: onAccept },
    ]);
  }

  function confirmDecline() {
    Alert.alert('Decline trade?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Decline', style: 'destructive', onPress: onDecline },
    ]);
  }

  function confirmComplete() {
    Alert.alert('Mark as completed?', 'Confirm you both exchanged the books.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Complete', onPress: onComplete },
    ]);
  }

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
          <PrimaryButton label="Accept" icon="checkmark" compact onPress={confirmAccept} />
          <SecondaryButton label="Decline" icon="close" compact onPress={confirmDecline} />
        </View>
      )}

      {isAccepted && (
        <>
          <ScrollView
            ref={chatRef}
            style={styles.chatBox}
            nestedScrollEnabled
            onContentSizeChange={() => chatRef.current?.scrollToEnd({ animated: false })}
          >
            {offer.messages.length === 0 ? (
              <Text style={[styles.mutedText, { padding: spacing.sm }]}>
                Trade accepted — chat to arrange meetup details.
              </Text>
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
                  <Text style={styles.messageTime}>
                    {new Date(item.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </Text>
                </View>
              ))
            )}
          </ScrollView>
          <View style={styles.messageComposer}>
            <TextInput
              value={message}
              onChangeText={setMessage}
              placeholder="Message"
              placeholderTextColor={colors.muted}
              style={styles.messageInput}
              returnKeyType="send"
              onSubmitEditing={() => {
                if (message.trim()) { onSend(message); setMessage(''); }
              }}
            />
            <IconButton
              icon="send"
              onPress={() => {
                if (message.trim()) { onSend(message); setMessage(''); }
              }}
            />
          </View>
          <PrimaryButton label="Mark completed" icon="checkmark-done" onPress={confirmComplete} />
        </>
      )}

      {isCompleted && !(offer.ratedBy ?? []).includes(currentProfile.id) && (
        <View style={{ gap: spacing.sm, marginTop: spacing.sm }}>
          <Text style={styles.label}>Rate this trade</Text>
          <Text style={styles.mutedText}>How was the experience? (attitude, friendliness, punctuality)</Text>
          <View style={styles.ratingRow}>
            {[1, 2, 3, 4, 5].map((r) => (
              <Pressable key={r} onPress={() => { onRate(r, review); }} style={styles.starButton}>
                <Ionicons name="star" size={26} color={colors.brass} />
              </Pressable>
            ))}
          </View>
          <TextInput
            value={review}
            onChangeText={setReview}
            placeholder="Optional written review…"
            placeholderTextColor={colors.muted}
            style={[styles.input, styles.textArea, { minHeight: 70 }]}
            multiline
          />
        </View>
      )}
      {isCompleted && (offer.ratedBy ?? []).includes(currentProfile.id) && (
        <Text style={[styles.mutedText, { marginTop: spacing.sm }]}>You've rated this trade. Thanks!</Text>
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

function UpdateBanner({
  build,
  progress,
  onUpdate,
  onDismiss,
}: {
  build: number;
  progress: number | null;
  onUpdate: () => void;
  onDismiss: () => void;
}) {
  const downloading = progress !== null;
  return (
    <View style={styles.updateBanner}>
      <View style={styles.updateBannerText}>
        <Text style={styles.updateBannerTitle}>Update available — build {build}</Text>
        {downloading ? (
          <View style={styles.updateProgressBar}>
            <View style={[styles.updateProgressFill, { width: `${Math.round(progress! * 100)}%` as unknown as number }]} />
          </View>
        ) : (
          <Text style={styles.updateBannerSub}>Download and install in one tap</Text>
        )}
      </View>
      {!downloading && (
        <View style={styles.updateBannerActions}>
          <Pressable onPress={onUpdate} style={styles.updateBtn}>
            <Ionicons name="download-outline" size={16} color="#fff" />
            <Text style={styles.updateBtnText}>Update</Text>
          </Pressable>
          <Pressable onPress={onDismiss} style={styles.updateDismiss}>
            <Ionicons name="close" size={18} color={colors.muted} />
          </Pressable>
        </View>
      )}
    </View>
  );
}

function TabBar({
  activeTab,
  onChange,
  badge,
}: {
  activeTab: TabKey;
  onChange: (tab: TabKey) => void;
  badge?: number;
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
        const showBadge = tab.key === 'trades' && badge && badge > 0;
        return (
          <Pressable key={tab.key} onPress={() => onChange(tab.key)} style={styles.tabButton}>
            <View>
              <Ionicons name={tab.icon} size={22} color={selected ? colors.teal : colors.muted} />
              {showBadge && (
                <View style={styles.tabBadge}>
                  <Text style={styles.tabBadgeText}>{badge > 9 ? '9+' : badge}</Text>
                </View>
              )}
            </View>
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
    overflow: 'hidden',
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: Platform.OS === 'android'
      ? (RNStatusBar.currentHeight ?? 24) + spacing.sm
      : spacing.sm,
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
  screen: {
    flex: 1,
    paddingHorizontal: spacing.lg,
  },
  scrollContent: {
    paddingBottom: spacing.xl,
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
    paddingTop: Platform.OS === 'android'
      ? (RNStatusBar.currentHeight ?? 24) + spacing.lg
      : spacing.lg,
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
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
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
    backgroundColor: colors.surfaceHigh,
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
    backgroundColor: colors.surfaceHigh,
    borderColor: colors.teal,
    borderRadius: 999,
    borderWidth: 1,
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
    backgroundColor: colors.surfaceHigh,
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
  photoEditBadge: {
    alignItems: 'center',
    backgroundColor: colors.teal,
    borderRadius: 10,
    bottom: 0,
    height: 20,
    justifyContent: 'center',
    position: 'absolute',
    right: 0,
    width: 20,
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
  updatesCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    gap: spacing.md,
    marginBottom: spacing.md,
    padding: spacing.md,
  },
  updatesHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  updatesTitle: {
    color: colors.ink,
    flex: 1,
    fontSize: 15,
    fontWeight: '800',
  },
  updatesBuild: {
    color: colors.muted,
    fontSize: 12,
  },
  upToDateRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  forgotLink: {
    alignItems: 'center',
    paddingVertical: spacing.xs,
  },
  forgotLinkText: {
    color: colors.muted,
    fontSize: 13,
  },
  verifyCard: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.lg,
    borderWidth: 1,
    gap: spacing.md,
    margin: spacing.lg,
    padding: spacing.xl,
  },
  verifyTitle: {
    color: colors.ink,
    fontSize: 22,
    fontWeight: '800',
    textAlign: 'center',
  },
  verifyBody: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 22,
    textAlign: 'center',
  },
  buildLabel: {
    color: colors.border,
    fontSize: 11,
    marginTop: spacing.lg,
    textAlign: 'center',
  },
  updateBanner: {
    alignItems: 'center',
    backgroundColor: colors.tealDark,
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  updateBannerText: {
    flex: 1,
    gap: 4,
  },
  updateBannerTitle: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
  },
  updateBannerSub: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 11,
  },
  updateProgressBar: {
    backgroundColor: 'rgba(255,255,255,0.3)',
    borderRadius: 4,
    height: 4,
    marginTop: 4,
    overflow: 'hidden',
  },
  updateProgressFill: {
    backgroundColor: '#FFFFFF',
    borderRadius: 4,
    height: 4,
  },
  updateBannerActions: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  updateBtn: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: radii.sm,
    flexDirection: 'row',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
  },
  updateBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
  },
  updateDismiss: {
    padding: 4,
  },
  tabBadge: {
    alignItems: 'center',
    backgroundColor: colors.danger,
    borderRadius: 8,
    height: 16,
    justifyContent: 'center',
    minWidth: 16,
    paddingHorizontal: 3,
    position: 'absolute',
    right: -6,
    top: -4,
  },
  tabBadgeText: {
    color: '#FFFFFF',
    fontSize: 9,
    fontWeight: '900',
  },
  messageTime: {
    color: colors.muted,
    fontSize: 10,
    marginTop: 2,
  },
  tabBar: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderTopColor: colors.border,
    borderTopWidth: 1,
    flexDirection: 'row',
    height: 76,
    justifyContent: 'space-around',
    paddingBottom: Platform.OS === 'ios' ? spacing.md : spacing.sm,
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
