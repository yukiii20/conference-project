import { env } from '../config/env.js'

/**
 * Every link that sends someone to sign in goes to a conference's OWN sign-in
 * page — a membership only works at its own conference, so there is no
 * generic sign-in to send them to.
 */
export function conferenceSignInPath(slug: string): string {
  return `/c/${encodeURIComponent(slug)}/login`
}

export function conferenceSignInUrl(slug: string): string {
  return `${env.APP_URL}${conferenceSignInPath(slug)}`
}

/** Invitation "set your password" link; the conference lets the page brand itself and sign the person in there. */
export function setPasswordUrl(rawToken: string, slug: string): string {
  return `${env.APP_URL}/set-password?token=${rawToken}&conference=${encodeURIComponent(slug)}`
}
