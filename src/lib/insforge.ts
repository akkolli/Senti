import { createClient } from '@insforge/sdk'

const baseUrl = import.meta.env.VITE_INSFORGE_URL
const anonKey = import.meta.env.VITE_INSFORGE_ANON_KEY

if (!baseUrl || !anonKey) {
  throw new Error('Missing VITE_INSFORGE_URL or VITE_INSFORGE_ANON_KEY')
}

export const insforge = createClient({ baseUrl, anonKey }) as any
