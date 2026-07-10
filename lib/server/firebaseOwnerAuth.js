const FIREBASE_APP_NAME = "gioia-refactor-server-auth";
const DEFAULT_OWNER_EMAIL = "gioiabeautyy@gmail.com";
const ISOLATED_PROJECT_ID = "demo-gioia-beauty";
const ISOLATED_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
export const MAX_FIREBASE_AUTHORIZATION_BYTES = 16 * 1024;

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
  const projectId = assertFirebaseOwnerAuthEnvironment();
  if (firebaseAuth) return firebaseAuth;

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

export function readFirebaseBearerToken(request) {
  const authorization = request.headers.get("authorization");
  if (authorization === null || authorization === "") {
    return { ok: false, status: 401, code: "authentication_required" };
  }
  if (
    Buffer.byteLength(authorization, "utf8") >
      MAX_FIREBASE_AUTHORIZATION_BYTES ||
    authorization.trim() !== authorization
  ) {
    return { ok: false, status: 401, code: "invalid_authentication" };
  }
  const match = authorization.match(
    /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*)$/i,
  );

  if (!match) {
    return { ok: false, status: 401, code: "invalid_authentication" };
  }
  return { ok: true, token: match[1] };
}

export async function requireFirebaseOwner(
  request,
  { loadAuth = getFirebaseAuth, env = process.env } = {},
) {
  const bearer = readFirebaseBearerToken(request);
  if (!bearer.ok) return bearer;

  let decodedToken;
  try {
    assertFirebaseOwnerAuthEnvironment(env);
    decodedToken = await (await loadAuth()).verifyIdToken(bearer.token);
  } catch (error) {
    if (error?.code === "auth_not_configured") {
      return { ok: false, status: 503, code: "authentication_unavailable" };
    }
    return { ok: false, status: 401, code: "invalid_authentication" };
  }

  if (!decodedToken || typeof decodedToken !== "object") {
    return { ok: false, status: 401, code: "invalid_authentication" };
  }
  const expectedEmail = (
    env.BOOKING_ADMIN_EMAIL || DEFAULT_OWNER_EMAIL
  ).toLowerCase();
  const tokenEmail =
    typeof decodedToken.email === "string"
      ? decodedToken.email.toLowerCase()
      : null;

  if (
    decodedToken.email_verified !== true ||
    tokenEmail !== expectedEmail ||
    typeof decodedToken.uid !== "string" ||
    decodedToken.uid === ""
  ) {
    return { ok: false, status: 403, code: "owner_authorization_required" };
  }

  return { ok: true, userId: decodedToken.uid };
}
