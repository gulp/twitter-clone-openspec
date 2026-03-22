import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        twitter: {
          blue: "#1d9bf0",
          "blue-hover": "#1a8cd8",
          dark: "#15202b",
          "dark-secondary": "#1e2732",
          border: "#2f3336",
          "text-gray": "#71767b",
          "text-light": "#e7e9ea",
        },
      },
    },
  },
  plugins: [],
};
export default config;
