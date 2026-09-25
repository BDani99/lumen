import { createClient } from '@supabase/supabase-js'
import { getSupabaseConfig } from '@/utils/supabase/config'

const { url: supabaseUrl, key: supabaseKey } = getSupabaseConfig()
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder'

if (typeof window === 'undefined' && !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  // Server routes/jobs would otherwise fail later with an opaque "Invalid API key".
  console.error('[supabase] SUPABASE_SERVICE_ROLE_KEY is not set — server-side database access will fail')
}

// For client-side or public data access
export const supabase = createClient(supabaseUrl, supabaseKey)

// For server-side admin access
export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey)
