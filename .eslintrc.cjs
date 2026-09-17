/**
 * ESLint configuration for ShopForge
 * TypeScript + React linting with Prettier compatibility
 */
module.exports = {
  root: true,
  parserOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
    ecmaFeatures: { jsx: true },
  },
  env: {
    browser: true,
    node: true,
    es2022: true,
  },
  settings: {
    react: { version: "detect" },
  },
  overrides: [
    {
      files: ["**/*.{ts,tsx}"],
      parser: "@typescript-eslint/parser",
      plugins: ["@typescript-eslint", "react"],
      extends: [
        "eslint:recommended",
        "plugin:@typescript-eslint/recommended",
        "plugin:react/recommended",
        "plugin:react/jsx-runtime",
        "prettier",
      ],
      rules: {
        // Warn on unused vars instead of error (friendlier for scaffold users)
        "@typescript-eslint/no-unused-vars": [
          "warn",
          { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
        ],
        // Allow explicit any in scaffold (users will tighten later)
        "@typescript-eslint/no-explicit-any": "warn",
        // React
        "react/prop-types": "off",
        "react/no-unescaped-entities": "off",
      },
    },
    {
      files: ["**/*.js", "**/*.cjs", "**/*.mjs"],
      extends: ["eslint:recommended", "prettier"],
    },
  ],
};
