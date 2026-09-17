import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        shopify: {
          green: "#008060",
          dark: "#1a1a2e",
        },
      },
    },
  },
  plugins: [],
};

export default config;
