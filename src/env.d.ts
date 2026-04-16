/// <reference path="../.astro/types.d.ts" />

type Runtime = import('@astrojs/cloudflare').Runtime<{
  DB: D1Database;
}>;

declare namespace App {
  interface Locals extends Runtime {
    userId: string;
  }
}
