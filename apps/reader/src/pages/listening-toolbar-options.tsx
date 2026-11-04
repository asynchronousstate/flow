import type { GetServerSideProps } from 'next'

/** Keep saved comparison links useful after Classic Ribbon became the default. */
export const getServerSideProps: GetServerSideProps = async ({ query }) => ({
  redirect: {
    destination:
      typeof query.book === 'string' && query.book.trim()
        ? `/?book=${encodeURIComponent(query.book)}&listening=1`
        : '/',
    permanent: false,
  },
})

export default function ListeningToolbarOptions() {
  return null
}
