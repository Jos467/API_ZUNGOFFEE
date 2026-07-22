import { createClient } from '@supabase/supabase-js';

// Cliente con SERVICE_ROLE_KEY -- bypassa RLS y Auth por completo.
// Solo para uso backend (creación de usuarios en Supabase Auth), nunca exponer al frontend.
export function supabaseAdmin() {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: { autoRefreshToken: false, persistSession: false },
    },
  );
}
