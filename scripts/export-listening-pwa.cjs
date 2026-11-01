/* Prepare a self-contained Sites checkout from the verified build's source archive. */
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const app = path.join(root, 'apps/listening-pwa')
const target = path.join(root, '.tmp/flow-listening-site')
const JSZip = require(require.resolve('jszip', {
  paths: [path.join(root, 'apps/reader')],
}))

async function main() {
  const archive = await JSZip.loadAsync(
    fs.readFileSync(path.join(app, 'dist/source.zip')),
  )
  for (const entry of Object.values(archive.files)) {
    if (entry.dir) continue
    const destination = path.resolve(target, entry.name)
    if (!destination.startsWith(target + path.sep))
      throw new Error('Unsafe archive path')
    fs.mkdirSync(path.dirname(destination), { recursive: true })
    fs.writeFileSync(destination, await entry.async('nodebuffer'))
  }
  fs.cpSync(path.join(app, 'dist'), path.join(target, 'dist'), {
    recursive: true,
  })
  fs.cpSync(path.join(app, '.openai'), path.join(target, '.openai'), {
    recursive: true,
  })
  fs.writeFileSync(
    path.join(target, '.gitignore'),
    'node_modules/\ndist/\n*.log\n',
  )
  console.log(target)
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
