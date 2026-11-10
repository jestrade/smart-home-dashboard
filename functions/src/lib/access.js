import { HttpsError } from 'firebase-functions/v2/https';
import { db, FieldValue } from './admin.js';

const ACCESS_DOC = 'config/access';

function verifiedEmail(auth) {
  if (!auth) throw new HttpsError('unauthenticated', 'Sign in first.');
  const email = auth.token.email;
  if (!email || auth.token.email_verified !== true) {
    throw new HttpsError('permission-denied', 'A verified email address is required.');
  }
  return email;
}

/** 'member' | 'unclaimed' | 'denied' for the caller. */
export async function accessStatusFor(auth) {
  const email = verifiedEmail(auth);
  const snap = await db.doc(ACCESS_DOC).get();
  const emails = snap.exists ? snap.get('emails') ?? [] : [];
  if (emails.length === 0) return 'unclaimed';
  return emails.includes(email) ? 'member' : 'denied';
}

export async function assertMember(auth) {
  const status = await accessStatusFor(auth);
  if (status !== 'member') {
    throw new HttpsError('permission-denied', 'This account is not allowed to use this dashboard.');
  }
  return auth.token.email;
}

/** The first verified user to call this becomes the owner. Add more emails to config/access in the console. */
export async function claimDashboard(auth) {
  const email = verifiedEmail(auth);
  const ref = db.doc(ACCESS_DOC);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists && (snap.get('emails') ?? []).length > 0) {
      throw new HttpsError('already-exists', 'This dashboard already has an owner.');
    }
    tx.set(ref, { emails: [email], owner: email, createdAt: FieldValue.serverTimestamp() });
  });
  return email;
}
