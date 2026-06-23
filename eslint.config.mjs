import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  // Never lint build output, deps, or the JS tooling files.
  {
    ignores: ["dist/**", "out/**", "node_modules/**", ".vscode-test/**"],
  },

  // Base JS recommended rules.
  js.configs.recommended,

  // Strictest type-aware TypeScript rule sets.
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,

  {
    files: ["**/*.ts"],

    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      parserOptions: {
        // Enable full type-aware linting against the project's tsconfig.
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },

    linterOptions: {
      // Flag `eslint-disable` directives that no longer suppress anything.
      reportUnusedDisableDirectives: "error",
    },

    rules: {
      // --- carried over from the original config, promoted to errors ---
      "@typescript-eslint/naming-convention": [
        "error",
        { selector: "import", format: ["camelCase", "PascalCase"] },
      ],
      curly: "error",
      eqeqeq: ["error", "always"],
      "no-throw-literal": "error",
      semi: "error",

      // --- extra strictness on top of the preset configs ---
      "@typescript-eslint/explicit-function-return-type": [
        "error",
        { allowExpressions: true },
      ],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/switch-exhaustiveness-check": "error",
      "no-console": "error",
    },
  },
);
