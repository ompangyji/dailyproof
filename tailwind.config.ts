import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        ink: "#0a0a0a",
        paper: "#fafaf2",
        lime: "#ddfc69",
        "lime-deep": "#c4e84a",
        electric: "#0b99ff",
        coral: "#ff6638",
        sun: "#ebd22f",
      },
      fontFamily: {
        body: ["var(--font-body)", "ui-sans-serif", "system-ui", "sans-serif"],
        display: ["var(--font-display)", "Impact", "sans-serif"],
        tag: ["var(--font-tag)", "cursive"],
      },
      boxShadow: {
        brut: "4px 4px 0 0 #0a0a0a",
        "brut-sm": "3px 3px 0 0 #0a0a0a",
        "brut-lg": "6px 6px 0 0 #0a0a0a",
      },
      borderRadius: {
        chunk: "1.25rem",
      },
    },
  },
  plugins: [],
};

export default config;
