import { createClient } from '@supabase/supabase-js'
import { HAS_BACKEND, SUPABASE_URL, SUPABASE_ANON_KEY } from './config'

export const supabase = HAS_BACKEND
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true } })
  : null
