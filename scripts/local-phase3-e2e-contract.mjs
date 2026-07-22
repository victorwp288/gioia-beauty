export const LOCAL_PHASE3_E2E_BOOKING_HMAC_SECRET =
  "phase3-local-e2e-booking-hmac-secret-000000000000";

export const LOCAL_PHASE4_OWNER_LOGIN_NETWORK = "127.0.0.1";

// Public local-only fixture credential. Never reuse it outside disposable Local/CI.
export const LOCAL_SYNTHETIC_OWNER = Object.freeze({
  id: "51000000-0000-4000-8000-000000000001",
  email: "owner.local@gioia.test",
  password: "GioiaLocal1!NotSecret", // gitleaks:allow
});
