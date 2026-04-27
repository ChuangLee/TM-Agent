import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";

export default tseslint.config(
  {
    ignores: ["dist/**", "node_modules/**", "playwright-report/**", "test-results/**", "scripts/**"]
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/frontend/**/*.{ts,tsx}"],
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh
    },
    languageOptions: {
      globals: { ...globals.browser }
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }]
    }
  },
  {
    files: ["src/backend/**/*.ts"],
    languageOptions: {
      globals: { ...globals.node }
    }
  },
  {
    files: ["tests/**/*.{ts,tsx}"],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser }
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "off"
    }
  },
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }
      ],
      "no-console": ["warn", { allow: ["warn", "error", "info"] }]
    }
  }
);
