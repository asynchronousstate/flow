const crypto = require('crypto')
const fs = require('fs')
const { createRequire } = require('module')
const path = require('path')

async function build() {
  const root = __dirname
  const standalone = fs.existsSync(path.join(root, 'shared'))
  const shared = standalone
    ? path.join(root, 'shared')
    : path.resolve(root, '../reader/src/listening')
  const publicDir = standalone
    ? path.join(root, 'public')
    : path.resolve(root, '../reader/public')
  const epubjs = standalone
    ? path.join(root, 'vendor/epubjs')
    : path.resolve(root, '../../packages/epubjs')
  const navigation = standalone
    ? path.join(epubjs, 'navigation.js')
    : path.join(epubjs, 'src/navigation.js')
  const dist = path.join(root, 'dist')
  let esbuild
  try {
    esbuild = require('esbuild')
  } catch {
    esbuild = createRequire(require.resolve('tsup'))('esbuild')
  }
  fs.mkdirSync(path.join(dist, 'assets'), { recursive: true })
  fs.cpSync(path.join(root, 'public'), dist, { recursive: true })
  for (const name of ['icons', 'samples'])
    fs.cpSync(path.join(publicDir, name), path.join(dist, name), {
      recursive: true,
    })
  const license = standalone
    ? path.join(root, 'LICENSE')
    : path.resolve(root, '../../LICENSE')
  fs.copyFileSync(license, path.join(dist, 'LICENSE.txt'))
  fs.copyFileSync(
    path.join(epubjs, 'LICENSE'),
    path.join(dist, 'LICENSE-epubjs.txt'),
  )
  await esbuild.build({
    entryPoints: [path.join(root, 'src/main.tsx')],
    bundle: true,
    minify: true,
    target: ['es2020'],
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
    outfile: path.join(dist, 'assets/app.js'),
    nodePaths: [
      ...(process.env.NODE_PATH || '').split(path.delimiter).filter(Boolean),
      ...(standalone
        ? [path.join(root, 'node_modules')]
        : [
            path.resolve(root, '../reader/node_modules'),
            path.join(epubjs, 'node_modules'),
          ]),
    ],
    plugins: [
      {
        name: 'shared-listener',
        setup(build) {
          build.onResolve(
            { filter: /^@flow\/epubjs\/src\/navigation$/ },
            () => ({ path: navigation }),
          )
          build.onResolve({ filter: /^@flow\/listening\// }, (args) => {
            const name = args.path.replace('@flow/listening/', '')
            return {
              path: path.join(
                shared,
                name.includes('.') ? name : name + '.tsx',
              ),
            }
          })
        },
      },
    ],
  })
  // Distribute the corresponding, independently buildable source with the app.
  const JSZip = require(require.resolve('jszip', {
    paths: [root, path.resolve(root, '../reader')],
  }))
  const zip = new JSZip()
  const add = (name, data) =>
    zip.file(name, data, {
      date: new Date('2020-01-01T00:00:00Z'),
      createFolders: false,
    })
  function addDirectory(directory, prefix) {
    for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, item.name)
      const name = prefix + '/' + item.name
      if (item.isDirectory()) addDirectory(file, name)
      else add(name, fs.readFileSync(file))
    }
  }
  for (const file of ['build.cjs', 'sw-template.js', 'README.md'])
    add(file, fs.readFileSync(path.join(root, file)))
  const sourcePackage = JSON.parse(
    fs.readFileSync(path.join(root, 'package.json'), 'utf8'),
  )
  sourcePackage.dependencies = {
    ...sourcePackage.dependencies,
    '@xmldom/xmldom': '0.7.13',
  }
  add('package.json', JSON.stringify(sourcePackage, null, 2) + '\n')
  add('LICENSE', fs.readFileSync(license))
  addDirectory(path.join(root, 'src'), 'src')
  addDirectory(path.join(root, 'public'), 'public')
  addDirectory(shared, 'shared')
  if (standalone) addDirectory(epubjs, 'vendor/epubjs')
  else {
    for (const [source, target] of [
      ['src/navigation.js', 'navigation.js'],
      ['src/utils/core.js', 'utils/core.js'],
      ['types/navigation.d.ts', 'types/navigation.d.ts'],
      ['LICENSE', 'LICENSE'],
    ])
      add('vendor/epubjs/' + target, fs.readFileSync(path.join(epubjs, source)))
  }
  if (!standalone) {
    for (const name of ['icons', 'samples'])
      addDirectory(path.join(publicDir, name), 'public/' + name)
  }
  const config = JSON.parse(
    fs.readFileSync(path.join(root, 'tsconfig.json'), 'utf8'),
  )
  config.compilerOptions.paths = {
    '@flow/listening/*': ['shared/*'],
    '@flow/epubjs/src/navigation': ['vendor/epubjs/types/navigation.d.ts'],
    '@flow/epubjs/types/navigation': ['vendor/epubjs/types/navigation.d.ts'],
  }
  add('tsconfig.json', JSON.stringify(config, null, 2) + '\n')
  fs.writeFileSync(
    path.join(dist, 'source.zip'),
    await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }),
  )
  const files = []
  function walk(dir) {
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, item.name)
      if (item.isDirectory()) walk(file)
      else if (item.name !== 'sw.js')
        files.push('/' + path.relative(dist, file).replace(/\\/g, '/'))
    }
  }
  walk(dist)
  const assets = ['/', ...files.filter((file) => file !== '/index.html')].sort()
  const hash = crypto.createHash('sha256')
  for (const file of files.sort())
    hash.update(file).update(fs.readFileSync(path.join(dist, file)))
  hash.update(fs.readFileSync(path.join(root, 'sw-template.js')))
  const version = 'flow-listening-' + hash.digest('hex').slice(0, 16)
  const worker = fs
    .readFileSync(path.join(root, 'sw-template.js'), 'utf8')
    .replace('__CACHE__', version)
    .replace('__ASSETS__', JSON.stringify(assets))
  fs.writeFileSync(path.join(dist, 'sw.js'), worker)
  console.log(JSON.stringify({ dist, version, precachedAssets: assets.length }))
}
build().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
