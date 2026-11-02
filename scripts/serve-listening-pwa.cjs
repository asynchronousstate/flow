const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')

const root = path.resolve(__dirname, '../apps/listening-pwa/dist')
const mime = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
  '.epub': 'application/epub+zip',
  '.txt': 'text/plain',
}
function createServer() {
  return http.createServer((request, response) => {
    let pathname
    try {
      pathname = decodeURIComponent(
        new URL(request.url, 'http://localhost').pathname,
      )
    } catch {
      response.writeHead(400).end()
      return
    }
    const file = path.resolve(
      root,
      '.' + (pathname === '/' ? '/index.html' : pathname),
    )
    if (!file.startsWith(root + path.sep)) {
      response.writeHead(403).end()
      return
    }
    fs.readFile(file, (error, data) => {
      if (error) {
        response.writeHead(404).end('Not found')
        return
      }
      response.writeHead(200, {
        'Content-Type': mime[path.extname(file)] || 'application/octet-stream',
        'Cache-Control': 'no-cache',
      })
      response.end(data)
    })
  })
}
module.exports = { createServer }
if (require.main === module)
  createServer().listen(7130, '127.0.0.1', () =>
    console.log('Local: http://127.0.0.1:7130'),
  )
