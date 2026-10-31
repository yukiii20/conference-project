import { useParams } from 'react-router-dom'
import { WithConference } from '../../components/auth/ConferenceAuthShell'
import { ForgotPasswordPage } from '../ForgotPasswordPage'

/** /c/:slug/forgot-password — the reset link it sends opens this conference's branded reset page. */
export function ConferenceForgotPasswordPage() {
  const { slug } = useParams()
  return <WithConference slug={slug}>{(conference) => <ForgotPasswordPage conference={conference} />}</WithConference>
}
