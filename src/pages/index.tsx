import { Seo } from '../components/Seo'
import { seo } from '../seo'

/** Fallback redirect for static hosts; the worker redirects `/` before assets. */
export default function Landing() {
  return (
    <main>
      <Seo {...seo} path="/" />
      <meta httpEquiv="refresh" content="0;url=/travel" />
      <p>
        Redirecting to Travel Together. If you are not redirected,{' '}
        <a href="/travel">open the app</a>.
      </p>
    </main>
  )
}
