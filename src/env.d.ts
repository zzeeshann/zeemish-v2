/// <reference path="../.astro/types.d.ts" />

type Runtime = import('@astrojs/cloudflare').Runtime<{
  DB: D1Database;
  RATE_LIMIT_KV: KVNamespace;
}>;

declare namespace App {
  interface Locals extends Runtime {
    userId: string;
  }
}
