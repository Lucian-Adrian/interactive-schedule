import { createClient } from '@supabase/supabase-js'

const fallbackUrl = 'https://ysswamnkarliovhfoczj.supabase.co'
const fallbackAnon =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inlzc3dhbW5rYXJsaW92aGZvY3pqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA2NjQwNzUsImV4cCI6MjA4NjI0MDA3NX0.gSoDBZ_oMczmZnHkHN4n0v_NUCUPkWj5I-ajUX81Wzs'

const url =
  (import.meta.env.PUBLIC_SUPABASE_URL as string | undefined) ??
  (import.meta.env.VITE_SUPABASE_URL as string | undefined) ??
  fallbackUrl
const anon =
  (import.meta.env.PUBLIC_SUPABASE_ANON_KEY as string | undefined) ??
  (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ??
  fallbackAnon

if (!import.meta.env.PUBLIC_SUPABASE_URL && !import.meta.env.VITE_SUPABASE_URL) {
  // eslint-disable-next-line no-console
  console.warn('Missing Supabase env vars. Using built-in public fallback config.')
}

export const supabase = createClient(url, anon)
