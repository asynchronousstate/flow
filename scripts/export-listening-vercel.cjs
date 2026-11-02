/* Export the verified PWA build to an isolated Vercel static deployment. */
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const app = path.join(root, 'apps/listening-pwa')
const dist = path.join(app, 'dist')
const staging = path.join(root, '.tmp/flow-listening-vercel')
const output = path.join(staging, 'public')

function collectFiles(directory, prefix = '') {
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      assert(
        !entry.isSymbolicLink(),
        'Deployment assets must not be symbolic links',
      )
      const relative = path.join(prefix, entry.name)
      return entry.isDirectory()
        ? collectFiles(path.join(directory, entry.name), relative)
        : [relative]
    })
    .sort()
}

function main() {
  for (const name of [
    'index.html',
    'sw.js',
    'manifest.webmanifest',
    'source.zip',
  ])
    assert(
      fs.existsSync(path.join(dist, name)),
      'Build the PWA before exporting: ' + name,
    )
  const files = collectFiles(dist)
  fs.mkdirSync(staging, { recursive: true })
  // Remove only this generated public directory, preserving Vercel project linkage.
  assert.equal(
    fs.realpathSync(staging),
    staging,
    'Export directory must not redirect outside the workspace',
  )
  assert.equal(path.dirname(output), staging)
  if (fs.existsSync(output)) {
    assert(
      !fs.lstatSync(output).isSymbolicLink(),
      'Public directory must not be a symbolic link',
    )
    assert.equal(fs.realpathSync(output), output)
    fs.rmSync(output, { recursive: true, force: true })
  }
  fs.mkdirSync(output, { recursive: true })
  const digest = crypto.createHash('sha256')
  for (const file of files) {
    const source = fs.readFileSync(path.join(dist, file))
    const destination = path.join(output, file)
    fs.mkdirSync(path.dirname(destination), { recursive: true })
    fs.writeFileSync(destination, source)
    assert(
      source.equals(fs.readFileSync(destination)),
      'Copied asset differs: ' + file,
    )
    digest.update(file.replace(/\\/g, '/')).update(source)
  }
  assert.deepEqual(
    collectFiles(output),
    files,
    'Deployment must contain exactly the built assets',
  )
  fs.copyFileSync(
    path.join(app, 'deployment/vercel.json'),
    path.join(staging, 'vercel.json'),
  )
  // Linking can create an OIDC .env.local; never upload it on later exports.
  const ignored = '.vercel/\n.env*\n.git/\n'
  fs.writeFileSync(path.join(staging, '.gitignore'), ignored)
  fs.writeFileSync(path.join(staging, '.vercelignore'), ignored)
  console.log(
    JSON.stringify(
      {
        directory: staging,
        staticDirectory: output,
        files: files.length,
        sha256: digest.digest('hex'),
        verified: 'All exported asset bytes match apps/listening-pwa/dist',
      },
      null,
      2,
    ),
  )
}

try {
  main()
} catch (error) {
  console.error(error)
  process.exitCode = 1
}
