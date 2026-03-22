import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/app/**/*.{js,ts,jsx,tsx,mdx}", "./src/components/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        twitter: {
          blue: "#1DA1F2",
          darkBlue: "#1A91DA",
          black: "#14171A",
          darkGray: "#657786",
          lightGray: "#AAB8C2",
          extraLightGray: "#E1E8ED",
          extraExtraLightGray: "#F5F8FA",
        },
      },
    },
  },
  plugins: [],
};

export default config;
