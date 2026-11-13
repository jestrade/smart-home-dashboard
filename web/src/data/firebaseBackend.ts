import { initializeApp } from 'firebase/app';
import {
  GoogleAuthProvider, connectAuthEmulator, getAuth, onAuthStateChanged, signInWithPopup, signOut,
} from 'firebase/auth';
import {
  Timestamp, collection, connectFirestoreEmulator, doc, getFirestore, limit, onSnapshot, orderBy, query,
  serverTimestamp, setDoc, updateDoc,
} from 'firebase/firestore';
import { connectFunctionsEmulator, getFunctions, httpsCallable } from 'firebase/functions';
import type { Backend, SyncResult } from './backend';
import type { AccessStatus, ActivityEvent, Device, EnergyDay, HomeLayout, IntegrationStatus, ProviderId } from '../types';

const REGION = 'us-central1';

export const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const toDate = (v: unknown) => (v instanceof Timestamp ? v.toDate() : null);

export function createFirebaseBackend(): Backend {
  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app);
  const db = getFirestore(app);
  const fns = getFunctions(app, REGION);
  const useEmulators = import.meta.env.VITE_USE_EMULATORS === 'true';
  // Local development: functions run on this machine, against the real Auth and Firestore.
  const localFunctions = import.meta.env.VITE_USE_FUNCTIONS_EMULATOR === 'true';
  if (useEmulators) {
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    connectFirestoreEmulator(db, '127.0.0.1', 8080);
  }
  if (useEmulators || localFunctions) connectFunctionsEmulator(fns, '127.0.0.1', 5001);
  const call = <T,>(name: string, data?: unknown) =>
    httpsCallable<unknown, T>(fns, name)(data).then((r) => r.data);

  return {
    mode: 'firebase',

    onAuth: (cb) =>
      onAuthStateChanged(auth, (u) =>
        cb(u ? { email: u.email, displayName: u.displayName, photoURL: u.photoURL } : null),
      ),
    signIn: async () => {
      await signInWithPopup(auth, new GoogleAuthProvider());
    },
    signOut: () => signOut(auth),
    accessStatus: async () => (await call<{ status: AccessStatus }>('accessStatus')).status,
    claim: async () => {
      await call('claim');
    },

    subscribeDevices: (cb, onError) =>
      onSnapshot(
        collection(db, 'devices'),
        (snap) =>
          cb(snap.docs.map((d) => ({ ...(d.data() as Device), id: d.id, updatedAt: toDate(d.get('updatedAt')) }))),
        onError,
      ),
    subscribeStatus: (cb) =>
      onSnapshot(collection(db, 'integrationStatus'), (snap) => {
        const out: Partial<Record<ProviderId, IntegrationStatus>> = {};
        snap.forEach((d) => {
          out[d.id as ProviderId] = {
            ...(d.data() as IntegrationStatus),
            provider: d.id as ProviderId,
            lastSyncAt: toDate(d.get('lastSyncAt')),
          };
        });
        cb(out);
      }),
    subscribeEvents: (cb) =>
      onSnapshot(query(collection(db, 'events'), orderBy('at', 'desc'), limit(50)), (snap) =>
        cb(snap.docs.map((d) => ({ ...(d.data() as ActivityEvent), id: d.id, at: toDate(d.get('at')) }))),
      ),

    sendCommand: async (deviceId, action, value) => {
      await call('sendCommand', { deviceId, action, value });
    },
    updatePrefs: async (deviceId, prefs) => {
      await updateDoc(doc(db, 'devices', deviceId), { prefs });
    },
    subscribeLayout: (cb) =>
      onSnapshot(doc(db, 'layout', 'home'), (snap) => {
        const d = snap.data() as Partial<HomeLayout> | undefined;
        cb({ rooms: d?.rooms ?? [], order: d?.order ?? {}, widgets: d?.widgets ?? {}, floorplan: d?.floorplan ?? {}, sections: d?.sections ?? [] });
      }),
    saveLayout: async (layout) => {
      await setDoc(doc(db, 'layout', 'home'), { rooms: layout.rooms, order: layout.order, widgets: layout.widgets ?? {}, floorplan: layout.floorplan ?? {}, sections: layout.sections ?? [], updatedAt: serverTimestamp() });
    },
    energyDay: (date) => call<EnergyDay>('getEnergyDay', { date }),
    sync: async (provider) => (await call<{ results: SyncResult[] }>('syncDevices', { provider })).results,

    saveIntegration: async (provider, config) => {
      await call('saveIntegration', { provider, config });
    },
    createBridgeToken: (provider) => call<{ token: string; endpoint: string }>('createBridgeToken', { provider }),
    connectUrl: (provider) =>
      call<{ url: string; redirectUri: string }>('getAuthUrl', { provider, appUrl: window.location.origin }),
    redirectUri: () =>
      useEmulators
        ? `http://127.0.0.1:5001/${firebaseConfig.projectId}/${REGION}/oauthCallback`
        : `https://${REGION}-${firebaseConfig.projectId}.cloudfunctions.net/oauthCallback`,
    disconnect: async (provider) => {
      await call('disconnectIntegration', { provider });
    },
  };
}
