import { base } from "./base.js";

/**
 * ESLint config for the three Next.js apps.
 * Next-specific rules are handled by `next build`'s own checks; this keeps the
 * shared TS rules identical across apps and services.
 */
export const next = [
  ...base,
  {
    files: ["**/*.tsx"],
    rules: {
      "@typescript-eslint/no-empty-object-type": "off",
    },
  },
];

export default next;
