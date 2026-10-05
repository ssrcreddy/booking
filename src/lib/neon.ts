import { createClient } from '@neondatabase/neon-js';

const authUrl = import.meta.env.VITE_NEON_AUTH_URL as string | undefined;
const dataApiUrl = import.meta.env.VITE_NEON_DATA_API_URL as string | undefined;

export const neonConfigured = Boolean(authUrl && dataApiUrl);

/** Single Neon client: Neon Auth session + Data API with the user's JWT attached. */
export const neon = createClient({
  auth: { url: authUrl ?? 'https://not-configured.invalid' },
  dataApi: { url: dataApiUrl ?? 'https://not-configured.invalid' },
});
