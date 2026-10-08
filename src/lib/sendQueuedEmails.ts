import { supabase } from './supabase'

/**
 * Flushes the email queue (send-queued-emails). Called after actions that
 * queue an email (submit abstract, assign reviewer, record decision) — never
 * throws and never blocks the user's flow. Returns true if the request went
 * through (regardless of per-row outcomes, which the function retries on its
 * own), false if it couldn't be reached at all — callers should show
 * "Saved. Email will be retried." in that case rather than treating it as a
 * failure of the action itself.
 */
export async function sendQueuedEmails(): Promise<boolean> {
  try {
    const { error } = await supabase.functions.invoke('send-queued-emails')
    return !error
  } catch {
    return false
  }
}
