/// <reference path="../.astro/types.d.ts" />

type Runtime = import('@astrojs/cloudflare').Runtime<{
  DB: D1Database;
  RATE_LIMIT_KV: KVNamespace;
  AUDIO_BUCKET: R2Bucket;
}>;

declare namespace App {
  interface Locals extends Runtime {
    userId: string;
  }
}
