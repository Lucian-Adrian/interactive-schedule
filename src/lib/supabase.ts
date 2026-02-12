import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.PUBLIC_SUPABASE_URL as string | undefined
const anon = import.meta.env.PUBLIC_SUPABASE_ANON_KEY as string | undefined

if (!url || !anon) {
  // eslint-disable-next-line no-console
  console.warn('Missing Supabase env vars: PUBLIC_SUPABASE_URL / PUBLIC_SUPABASE_ANON_KEY')
}

export const supabase = createClient(url ?? '', anon ?? '')
