/**
 * TEST-ONLY helper — promotes/demotes a QA account's mux_profiles.role using
 * the app's own privileged-field bridge (ADMIN_BOOTSTRAP_* sign-in, exactly
 * what src/lib/admin-auth.ts does for verify/block actions). The DB trigger
 * rejects service-key role writes, so the bootstrap admin JWT is required.
 *
 * Usage: bun run scripts/qa-admin.ts <email> admin|user
 */
import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const publishable = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
const secret = process.env.SUPABASE_SECRET_KEY
const bootstrapEmail = process.env.ADMIN_BOOTSTRAP_EMAIL
const bootstrapPassword = process.env.ADMIN_BOOTSTRAP_PASSWORD

if (!url || !publishable || !secret || !bootstrapEmail || !bootstrapPassword) {
  console.error('Missing required env vars (SUPABASE / ADMIN_BOOTSTRAP_*).')
  process.exit(1)
}

const targetEmail = process.argv[2]?.toLowerCase().trim()
const role = process.argv[3]
if (!targetEmail || (role !== 'admin' && role !== 'user')) {
  console.error('Usage: bun run scripts/qa-admin.ts <email> admin|user')
  process.exit(1)
}

const service = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } })

// The target profile must exist (register it through the app first).
const { data: target, error: targetError } = await service
  .from('mux_profiles')
  .select('id, email, role')
  .eq('email', targetEmail)
  .maybeSingle()
if (targetError || !target) {
  console.error(`Profile not found for ${targetEmail}: ${targetError?.message ?? 'no row'}`)
  process.exit(1)
}

// Sign in as the bootstrap admin (publishable key, isolated throwaway client).
const anon = createClient(url, publishable, { auth: { persistSession: false, autoRefreshToken: false } })
const { data: signIn, error: signInError } = await anon.auth.signInWithPassword({
  email: bootstrapEmail,
  password: bootstrapPassword,
})
if (signInError || !signIn?.session?.access_token) {
  console.error('Bootstrap sign-in failed:', signInError?.message)
  process.exit(1)
}

// Privileged update with the admin user JWT (the trigger's requirement).
const adminClient = createClient(url, publishable, {
  global: { headers: { Authorization: `Bearer ${signIn.session.access_token}` } },
  auth: { persistSession: false, autoRefreshToken: false },
})
const { error: updateError } = await adminClient
  .from('mux_profiles')
  .update({ role, updated_at: new Date().toISOString() })
  .eq('id', target.id)
if (updateError) {
  console.error(`Role update failed: ${updateError.message}`)
  process.exit(1)
}

console.log(`OK — ${targetEmail} is now role=${role}`)
