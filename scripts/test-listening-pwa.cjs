/* Build first: node apps/listening-pwa/build.cjs
 * Uses Playwright and installed desktop Edge, with an Android-sized viewport.
 * PLAYWRIGHT_MODULE and EDGE_PATH can point to existing local installations.
 * PWA_TEST_URL can target a deployed HTTPS origin instead of the local server.
 * Every run uses a fresh isolated profile; it never imports user browser data.
 * This cannot verify Android native Read Aloud or screen-off behavior.
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
const { createServer } = require('./serve-listening-pwa.cjs')

async function main() {
  const root = path.resolve(__dirname, '..')
  const edge =
    process.env.EDGE_PATH ||
    path.join(
      process.env['ProgramFiles(x86)'] || '/opt',
      'Microsoft/Edge/Application/msedge.exe',
    )
  let server
  let base
  if (process.env.PWA_TEST_URL) {
    const target = new URL(process.env.PWA_TEST_URL)
    assert.equal(target.protocol, 'https:', 'Remote PWA tests require HTTPS')
    assert(
      !target.username && !target.password,
      'Do not put credentials in the test URL',
    )
    assert(
      target.pathname === '/' && !target.search && !target.hash,
      'PWA_TEST_URL must be the app origin, with no path or token',
    )
    base = target.origin
  } else {
    server = createServer()
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    base = 'http://127.0.0.1:' + server.address().port
  }
  let context
  fs.mkdirSync(path.join(root, '.tmp'), { recursive: true })
  const profile = fs.mkdtempSync(path.join(root, '.tmp/pwa-profile-'))
  try {
    context = await chromium.launchPersistentContext(profile, {
      executablePath: edge,
      headless: true,
      viewport: { width: 393, height: 852 },
      isMobile: true,
      hasTouch: true,
      userAgent:
        'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36 EdgA/130.0.0.0',
    })
    context.setDefaultTimeout(30000)
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    // Inspect real HTTP responses before a service worker can satisfy requests.
    const getAsset = async (asset, contentType) => {
      const response = await context.request.get(base + asset)
      assert.equal(
        response.status(),
        200,
        asset +
          ' must be publicly accessible to this fresh test profile; check deployment protection',
      )
      assert.equal(
        new URL(response.url()).origin,
        base,
        asset + ' redirected to another origin; check deployment protection',
      )
      assert.match(
        response.headers()['content-type'] || '',
        contentType,
        asset + ' content type',
      )
      return response
    }
    await getAsset('/', /^text\/html(?:;|$)/i)
    const manifestResponse = await getAsset(
      '/manifest.webmanifest',
      /^application\/manifest\+json(?:;|$)/i,
    )
    const manifest = await manifestResponse.json()
    const workerResponse = await getAsset(
      '/sw.js',
      /^(?:application|text)\/javascript(?:;|$)/i,
    )
    assert.match(
      workerResponse.headers()['cache-control'] || '',
      /(?:no-cache|no-store|max-age=0)/i,
      'Service worker must revalidate',
    )
    if (!server)
      assert.equal(
        workerResponse.headers()['service-worker-allowed'],
        '/',
        'Vercel service-worker root scope header',
      )
    for (const icon of manifest.icons) {
      assert(
        icon.src.startsWith('/') && !icon.src.startsWith('//'),
        'Icons must be same-origin root paths',
      )
      await getAsset(icon.src, /^image\/png(?:;|$)/i)
    }
    await getAsset(
      '/samples/alice.epub',
      /^(?:application\/epub\+zip|application\/octet-stream)(?:;|$)/i,
    )
    await getAsset(
      '/source.zip',
      /^(?:application\/zip|application\/octet-stream)(?:;|$)/i,
    )
    await page.goto(base)
    await page
      .getByRole('button', { name: 'Try Alice in Wonderland' })
      .waitFor()
    await page.waitForFunction(() => !!navigator.serviceWorker.controller)
    assert.equal(manifest.display, 'minimal-ui')
    assert.equal(manifest.scope, '/')
    assert(
      manifest.icons.some(
        (icon) => icon.sizes === '512x512' && icon.purpose === 'maskable',
      ),
    )
    const cdp = await context.newCDPSession(page)
    const installability = await cdp.send('Page.getInstallabilityErrors')
    assert.deepEqual(
      installability.installabilityErrors,
      [],
      'Manifest/installability requirements',
    )
    const noOverflow = async () =>
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        'No horizontal overflow',
      )
    await noOverflow()
    const screenshotDir = server
      ? path.join(root, '.tmp/pwa-testing')
      : path.join(root, '.tmp/pwa-testing', new URL(base).hostname)
    fs.mkdirSync(screenshotDir, { recursive: true })
    await page.screenshot({
      path: path.join(screenshotDir, 'phone-setup.png'),
      fullPage: true,
    })
    await page.getByRole('button', { name: 'Try Alice in Wonderland' }).click()
    await page.getByRole('combobox', { name: /^Begin with/ }).selectOption('1')
    await page.getByLabel('Starting paragraph').selectOption('17')
    await page.getByRole('button', { name: 'Prepare listening page' }).click()
    await page.locator('article section').first().waitFor()
    assert.equal(await page.locator('article > section').count(), 10)
    const text = await page.locator('article').innerText()
    assert(text.includes('finished off the cake'))
    assert(text.includes('The Pool Of Tears'))
    assert(text.includes('Curiouser and curiouser'))
    const expectedStart = await page.locator('article p').first().innerText()
    await page.waitForFunction(async () => {
      const database = await new Promise((resolve, reject) => {
        const r = indexedDB.open('flow-listening')
        r.onsuccess = () => resolve(r.result)
        r.onerror = reject
      })
      const saved = await new Promise((resolve) => {
        const r = database
          .transaction('session')
          .objectStore('session')
          .get('active-book')
        r.onsuccess = () => resolve(r.result)
      })
      database.close()
      return saved?.preferences.prepared && saved?.preferences.paragraph === 17
    })
    await context.setOffline(true)
    await page.goto(base + '/?source=homescreen')
    await page.locator('article section').first().waitFor()
    assert.equal(await page.locator('article > section').count(), 10)
    assert.equal(
      await page.locator('article p').first().innerText(),
      expectedStart,
    )
    await noOverflow()
    await page.screenshot({
      path: path.join(screenshotDir, 'phone-offline-reading.png'),
    })
    await page.getByRole('button', { name: 'Change session' }).click()
    assert.equal(
      await page.getByRole('combobox', { name: /^Begin with/ }).inputValue(),
      '1',
    )
    assert.equal(await page.getByLabel('Starting paragraph').inputValue(), '17')
    await page.setViewportSize({ width: 320, height: 720 })
    await noOverflow()
    await page.getByRole('button', { name: 'Forget saved book' }).click()
    await page
      .getByText('Saved book removed from this device.', { exact: true })
      .waitFor()
    await page.reload()
    await page
      .getByRole('button', { name: 'Try Alice in Wonderland' })
      .waitFor()
    assert.equal(
      await page.getByRole('combobox', { name: /^Begin with/ }).count(),
      0,
    )
    await page.getByRole('button', { name: 'Try Alice in Wonderland' }).click()
    await page.getByRole('combobox', { name: /^Begin with/ }).waitFor()
    // The cached sample and the real file-input workflow both work offline.
    await page
      .getByLabel('Open an EPUB', { exact: true })
      .setInputFiles(path.join(root, 'apps/reader/public/samples/alice.epub'))
    await page.getByRole('combobox', { name: /^Begin with/ }).waitFor()
    await noOverflow()
    assert.deepEqual(errors, [], 'No runtime exceptions')
    console.log(
      JSON.stringify(
        {
          passed: true,
          target: base,
          browser: context.browser().version(),
          checks: [
            'HTTP shell, manifest, icons, sample and source',
            'service-worker MIME and revalidation',
            'installability',
            '393px and 320px layouts',
            'Alice chapter order',
            'offline prepared-session restore',
            'range and paragraph restored',
            'forget survives reload',
            'offline sample',
            'offline file import',
            'no runtime errors',
          ],
          screenshots: screenshotDir,
        },
        null,
        2,
      ),
    )
  } finally {
    await context?.close()
    if (server) await new Promise((resolve) => server.close(resolve))
    if (
      path.dirname(profile) === path.join(root, '.tmp') &&
      path.basename(profile).startsWith('pwa-profile-')
    )
      fs.rmSync(profile, { recursive: true, force: true })
  }
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
