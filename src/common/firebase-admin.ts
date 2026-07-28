import { initializeApp, cert, getApps, type App } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';

let app: App | undefined;

// initializeApp() explota si se llama mas de una vez por proceso -- por eso
// el singleton perezoso, igual que supabaseAdmin() pero con este cuidado extra.
function firebaseApp(): App {
  if (!app) {
    app =
      getApps()[0] ??
      initializeApp({
        credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON!)),
      });
  }
  return app;
}

export function firebaseMessaging() {
  return getMessaging(firebaseApp());
}
