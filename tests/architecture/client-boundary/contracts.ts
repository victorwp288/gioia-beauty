export const SOURCE_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".mts",
  ".cts",
] as const;

export const TERMINAL_EXTENSIONS = new Set([
  ".avif",
  ".css",
  ".gif",
  ".ico",
  ".jpeg",
  ".jpg",
  ".json",
  ".less",
  ".otf",
  ".png",
  ".sass",
  ".scss",
  ".svg",
  ".ttf",
  ".webp",
  ".woff",
  ".woff2",
]);

export const EXCLUDED_SOURCE_ROOTS = new Set([
  "coverage",
  "docs",
  "images",
  "node_modules",
  "playwright-report",
  "public",
  "scripts",
  "styles",
  "supabase",
  "test-results",
  "tests",
]);

export const FORBIDDEN_PACKAGES = [
  "@supabase/ssr",
  "@supabase/supabase-js",
  "firebase-admin",
  "next/cache",
  "next/headers",
  "next/server",
  "postgres",
  "resend",
  "server-only",
  "sharp",
  "svix",
] as const;

export const FORBIDDEN_EXACT_PACKAGES = new Set([
  "next/cache.js",
  "next/headers.js",
  "next/server.js",
]);

export const SOURCE_EXTENSION_SUBSTITUTIONS: Readonly<
  Record<string, readonly string[]>
> = {
  ".js": [".ts", ".tsx", ".d.ts"],
  ".jsx": [".tsx", ".ts"],
  ".mjs": [".mts", ".d.mts"],
  ".cjs": [".cts", ".d.cts"],
};

export const ALLOWED_CLIENT_ENVIRONMENT_KEYS = new Set([
  "NODE_ENV",
  "NEXT_PUBLIC_API_URL",
  "NEXT_PUBLIC_APP_ENV",
  "NEXT_PUBLIC_ENABLE_ANALYTICS",
  "NEXT_PUBLIC_ENABLE_CHAT",
  "NEXT_PUBLIC_ENABLE_MOBILE",
  "NEXT_PUBLIC_ENABLE_MULTI_LANG",
  "NEXT_PUBLIC_ENABLE_PAYMENTS",
  "NEXT_PUBLIC_ENABLE_SMS",
  "NEXT_PUBLIC_ENABLE_WHATSAPP",
  "NEXT_PUBLIC_FIREBASE_API_KEY",
  "NEXT_PUBLIC_FIREBASE_APP_ID",
  "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN",
  "NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID",
  "NEXT_PUBLIC_FIREBASE_PROJECT_ID",
  "NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET",
]);

export type BoundaryViolationCode =
  | "CLIENT_REACHES_API_ROUTE"
  | "CLIENT_REACHES_SERVER_MODULE"
  | "AMBIGUOUS_LOCAL_IMPORT"
  | "DATABASE_MODULE_MISSING_SERVER_ONLY"
  | "DYNAMIC_CODE_EXECUTION"
  | "DYNAMIC_IMPORT_SPECIFIER"
  | "DYNAMIC_MODULE_LOADER"
  | "FORBIDDEN_ENV_ACCESS"
  | "FORBIDDEN_PACKAGE"
  | "GLOBAL_OBJECT_ALIAS"
  | "IMPORT_ESCAPES_ROOT"
  | "SOURCE_PARSE_ERROR"
  | "SOURCE_SYMLINK"
  | "UNSAFE_IMPORT_SPECIFIER"
  | "UNRESOLVED_LOCAL_IMPORT";

export interface BoundaryViolation {
  readonly code: BoundaryViolationCode;
  readonly module: string;
  readonly detail: string;
  readonly chain: readonly string[];
}

export interface ClientServerBoundaryOptions {
  readonly rootDir: string;
  readonly entryRoots?: readonly string[];
}

export interface RuntimeImport {
  readonly specifier: string | null;
  readonly display: string;
}

export interface Resolution {
  readonly path?: string;
  readonly terminal: boolean;
  readonly escaped: boolean;
  readonly ambiguous?: boolean;
}

export interface DynamicCodeViolation {
  readonly code: "DYNAMIC_CODE_EXECUTION" | "DYNAMIC_MODULE_LOADER";
  readonly detail: string;
}
