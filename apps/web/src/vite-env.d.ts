/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Registrable platform domain; reseller storefronts live on `{slug}.<domain>`. */
  readonly VITE_PLATFORM_DOMAIN?: string;
  /** Host of the manufacturer admin panel (may be another registrable domain). */
  readonly VITE_ADMIN_HOST?: string;
  /** `1` serves fixtures from src/api/mock.ts instead of calling the API. */
  readonly VITE_MOCK_API?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
