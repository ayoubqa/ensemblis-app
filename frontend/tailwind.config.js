/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0b0e1a",
        surface: "#121629",
        surface2: "#1a1f38",
        line: "#262c4a",
        accent: "#7c5cff",
        cyan: "#34d6c7",
      },
      fontFamily: {
        serif: ["Georgia", "serif"],
      },
    },
  },
  plugins: [require("@tailwindcss/typography")],
};
