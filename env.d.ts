interface ImportMetaEnv {
  /** Optional override for how many days back the crawler fetches. */
  readonly WXT_CRAWL_DAYS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
