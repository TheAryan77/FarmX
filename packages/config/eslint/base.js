import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

/**
 * Shared ESLint base for every FasalX workspace.
 * CLAUDE.md: TypeScript strict mode, no `any`.
 */
export const base = [
  { ignores: ["**/node_modules/**", "**/dist/**", "**/.next/**", "**/.turbo/**", "**/artifacts/**", "**/cache/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "no-console": "off",
      eqeqeq: ["error", "always"],
    },
  },
];

export default base;
