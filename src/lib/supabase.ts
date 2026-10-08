import { createClient } from '@supabase/supabase-js'

export const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
export const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

if (!supabaseUrl || !supabasePublishableKey) {
  throw new Error(
    'Missing VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY. Set them in .env.local.',
  )
}

const REMEMBER_ME_KEY = 'cms-remember-me'

/**
 * Backs the "Remember me" checkbox on sign-in. Default (true, matching the
 * app's behaviour before this flag existed) keeps the session in
 * localStorage, so it survives closing the browser; false switches to
 * sessionStorage, so it ends when the tab closes. Call this BEFORE
 * supabase.auth.signInWithPassword() so the session that gets written lands
 * in the right place.
 */
export function setRememberMe(remember: boolean) {
  localStorage.setItem(REMEMBER_ME_KEY, remember ? 'true' : 'false')
}

function rememberMeEnabled(): boolean {
  return localStorage.getItem(REMEMBER_ME_KEY) !== 'false'
}

const authStorage = {
  getItem: (key: string) => (rememberMeEnabled() ? localStorage : sessionStorage).getItem(key),
  setItem: (key: string, value: string) => {
    ;(rememberMeEnabled() ? localStorage : sessionStorage).setItem(key, value)
  },
  removeItem: (key: string) => {
    localStorage.removeItem(key)
    sessionStorage.removeItem(key)
  },
}

export const supabase = createClient(supabaseUrl, supabasePublishableKey, {
  auth: { storage: authStorage },
})
