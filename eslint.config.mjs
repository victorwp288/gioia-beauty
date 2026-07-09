import { FlatCompat } from "@eslint/eslintrc";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const baseDirectory = dirname(fileURLToPath(import.meta.url));
const compat = new FlatCompat({ baseDirectory });

const eslintConfig = [
  {
    ignores: [
      ".next/**",
      "coverage/**",
      "node_modules/**",
      "supabase/.branches/**",
      "supabase/.temp/**",
    ],
  },
  ...compat.extends("next/core-web-vitals"),
];

export default eslintConfig;
