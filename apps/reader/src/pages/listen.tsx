import Head from 'next/head'
import { useRouter } from 'next/router'

import ListeningApp from '../listening/ListeningApp'
import QuietListeningDocument from '../listening/QuietListeningDocument'

export default function Listen() {
  const router = useRouter()
  const book = router.query.book
  const session = router.query.session
  const validSession =
    session === undefined || (typeof session === 'string' && !!session.trim())

  return (
    <>
      <Head>
        <title>Edge Listening Mode · Flow</title>
        <meta name="robots" content="noindex" />
      </Head>
      {!router.isReady ? (
        <main className="flow-quiet">
          <p className="flow-quiet-loading" role="status">
            Preparing the quiet document…
          </p>
        </main>
      ) : book === undefined && session === undefined ? (
        <ListeningApp />
      ) : typeof book === 'string' && book.trim() && validSession ? (
        <QuietListeningDocument
          key={`${book}:${session || ''}`}
          bookId={book}
          sessionId={typeof session === 'string' ? session : undefined}
        />
      ) : (
        <main className="flow-quiet">
          <section className="flow-quiet-recovery" role="alert">
            <h1>This book link is incomplete</h1>
            <p>Choose the book from your Flow library to prepare a session.</p>
            <a href="/">Return to Flow library</a>
          </section>
        </main>
      )}
    </>
  )
}
