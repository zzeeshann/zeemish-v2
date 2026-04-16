/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
  theme: {
    extend: {
      colors: {
        zee: {
          bg: '#FAF8F4',
          text: '#1A1A1A',
          muted: '#6B6B6B',
          primary: '#1A6B62',
          gold: '#C49A1A',
          border: '#E8E4DE',
        },
      },
      fontFamily: {
        sans: ['"DM Sans"', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
