const FIREBASE_APP_NAME = "gioia-refactor-server-auth";
const DEFAULT_OWNER_EMAIL = "gioiabeautyy@gmail.com";
const ISOLATED_PROJECT_ID = "demo-gioia-beauty";
const ISOLATED_AUTH_EMULATOR_HOST = "127.0.0.1:9099";

let firebaseAuth;

export function assertFirebaseOwnerAuthEnvironment(env = process.env) {
  if (!["local", "test", "preview"].includes(env.APP_ENV)) {
    const error = new Error("Legacy Firebase owner authentication is disabled");
    error.code = "auth_not_configured";
    throw error;
  }

  const projectId =
    env.FIREBASE_ADMIN_PROJECT_ID || env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  if (
    projectId !== ISOLATED_PROJECT_ID ||
    env.FIREBASE_AUTH_EMULATOR_HOST !== ISOLATED_AUTH_EMULATOR_HOST
  ) {
    const error = new Error("Firebase owner authentication is not isolated");
    error.code = "auth_not_configured";
    throw error;
  }

  return projectId;
}

async function getFirebaseAuth() {
  if (firebaseAuth) return firebaseAuth;

  const projectId = assertFirebaseOwnerAuthEnvironment();

  const [{ getApps, initializeApp }, { getAuth }] = await Promise.all([
    import("firebase-admin/app"),
    import("firebase-admin/auth"),
  ]);

  const app =
    getApps().find((candidate) => candidate.name === FIREBASE_APP_NAME) ||
    initializeApp({ projectId }, FIREBASE_APP_NAME);

  firebaseAuth = getAuth(app);
  return firebaseAuth;
}

export async function requireFirebaseOwner(request) {
  const authorization = request.headers.get("authorization") || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);

  if (!match) {
    return { ok: false, status: 401, code: "authentication_required" };
  }

  let decodedToken;
  try {
    decodedToken = await (await getFirebaseAuth()).verifyIdToken(match[1]);
  } catch (error) {
    if (error?.code === "auth_not_configured") {
      return { ok: false, status: 503, code: "authentication_unavailable" };
    }
    return { ok: false, status: 401, code: "invalid_authentication" };
  }

  const expectedEmail = (
    process.env.BOOKING_ADMIN_EMAIL || DEFAULT_OWNER_EMAIL
  ).toLowerCase();
  const tokenEmail = decodedToken.email?.toLowerCase();

  if (!decodedToken.email_verified || tokenEmail !== expectedEmail) {
    return { ok: false, status: 403, code: "owner_authorization_required" };
  }

  return { ok: true, userId: decodedToken.uid };
}
