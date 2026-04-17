import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import tailwind from '@astrojs/tailwind';
import cloudflare from '@astrojs/cloudflare';
import rehypeBeats from './src/lib/rehype-beats.ts';

export default defineConfig({
  adapter: cloudflare(),
  integrations: [
    mdx({
      rehypePlugins: [rehypeBeats],
    }),
    tailwind(),
  ],
});
