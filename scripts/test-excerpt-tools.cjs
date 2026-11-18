/* Run the reader on localhost, then run with PLAYWRIGHT_MODULE if needed.
 * Uses a disposable Edge context and an original EPUB generated in memory.
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
const JSZip = require('../apps/reader/node_modules/jszip')

const base = new URL(process.env.FLOW_TEST_URL || 'http://127.0.0.1:7157/')
assert(
  ['127.0.0.1', 'localhost'].includes(base.hostname),
  'Use a local test server',
)
const edge =
  process.env.EDGE_PATH ||
  path.join(
    process.env['ProgramFiles(x86)'] || '/opt',
    'Microsoft/Edge/Application/msedge.exe',
  )
const book = 'Harbor Tools Fixture'
const passage = 'copper compass beside the tide chart'
const note = 'Leave a note at the compass.'
const edited = 'Edited from the EPUB reader.'
const bookmark = 'Begin the next watch here.'
const artifacts = process.env.FLOW_TEST_ARTIFACTS

async function screenshot(page, filename) {
  if (!artifacts) return
  fs.mkdirSync(artifacts, { recursive: true })
  await page.screenshot({ path: path.join(artifacts, filename) })
}

async function fixture() {
  const zip = new JSZip()
  zip.file('mimetype', 'application/epub+zip')
  zip.file(
    'META-INF/container.xml',
    '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="EPUB/book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
  )
  const contents = [
    [
      'harbor',
      'The Harbor',
      '<p>A copper <em>compass beside</em> the tide chart was still damp.</p><p>Begin the next watch here.</p><p>The tide is turning.</p><p>The tide is turning.</p><figure><img src="marker.png" alt="Harbor marker"/><figcaption>Harbor marker caption</figcaption></figure>',
    ],
    ['aux', 'Auxiliary Appendix', '<p>Appendix excluded from listening.</p>'],
    [
      'lighthouse',
      'The Lighthouse',
      '<p>Look for the amber lantern at the top of the stairs.</p>',
    ],
    [
      'orchard',
      'The Orchard',
      '<p>The silver apple dropped from the orchard branch.</p><figure><img src="marker.png" alt="Orchard marker"/></figure>',
    ],
  ]
  const linked = contents.filter(([id]) => id !== 'aux')
  const document = (title, body) =>
    '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>' +
    title +
    '</title></head><body>' +
    body +
    '</body></html>'
  const manifest = contents
    .map(
      ([id]) =>
        '<item id="' +
        id +
        '" href="' +
        id +
        '.xhtml" media-type="application/xhtml+xml"/>',
    )
    .join('')
  const spine = contents
    .map(
      ([id]) =>
        '<itemref idref="' +
        id +
        '"' +
        (id === 'aux' ? ' linear="no"' : '') +
        '/>',
    )
    .join('')
  zip.file(
    'EPUB/book.opf',
    '<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">urn:uuid:f5f595bb-83ef-4cfa-8660-a61acd726c18</dc:identifier><dc:title>' +
      book +
      '</dc:title><dc:language>en</dc:language></metadata><manifest><item id="toc" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="image" href="marker.png" media-type="image/png"/>' +
      manifest +
      '</manifest><spine>' +
      spine +
      '</spine></package>',
  )
  zip.file(
    'EPUB/nav.xhtml',
    document(
      'Contents',
      '<nav epub:type="toc"><ol>' +
        linked
          .map(
            ([id, name]) =>
              '<li><a href="' + id + '.xhtml">' + name + '</a></li>',
          )
          .join('') +
        '</ol></nav>',
    ),
  )
  for (const [id, name, prose] of contents)
    zip.file(
      'EPUB/' + id + '.xhtml',
      document(name, '<h1>' + name + '</h1>' + prose),
    )
  zip.file(
    'EPUB/marker.png',
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/3uoAAAAASUVORK5CYII=',
      'base64',
    ),
  )
  return {
    name: 'harbor-tools.epub',
    mimeType: 'application/epub+zip',
    buffer: await zip.generateAsync({ type: 'nodebuffer' }),
  }
}

const button = (scope, name) => scope.getByRole('button', { name, exact: true })
const panel = (page) => page.locator('#flow-listening-feature-panel')
const quietArticle = (page) => page.locator('article.flow-quiet-article')
const tools = (page) =>
  page.getByRole('navigation', { name: 'Flow reader tools' })
const markRects = (page) => page.locator('[data-listening-highlight]')

async function selectText(locator, phrase) {
  await locator.evaluate((element, phrase) => {
    const doc = element.ownerDocument
    const win = doc.defaultView
    const walker = doc.createTreeWalker(element, NodeFilter.SHOW_TEXT)
    const nodes = []
    let full = ''
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      nodes.push({ node, start: full.length })
      full += node.data
    }
    const offset = full.indexOf(phrase)
    if (offset < 0) throw new Error('Text to select is missing: ' + phrase)
    const first = nodes.findLast(({ start }) => start <= offset)
    const last = nodes.findLast(({ start }) => start < offset + phrase.length)
    const range = doc.createRange()
    range.setStart(first.node, offset - first.start)
    range.setEnd(last.node, offset + phrase.length - last.start)
    win.getSelection().removeAllRanges()
    win.getSelection().addRange(range)
    win.dispatchEvent(new win.MouseEvent('mouseup', { bubbles: true }))
  }, phrase)
}

async function openExcerpt(setup) {
  const [quiet] = await Promise.all([
    setup.waitForEvent('popup'),
    button(setup, 'Open listening view').click(),
  ])
  await quietArticle(quiet).waitFor()
  return quiet
}

async function closePanel(page) {
  await button(panel(page), 'Close tool panel').click()
  await panel(page).waitFor({ state: 'hidden' })
}

async function main() {
  const browser = await chromium.launch({
    executablePath: edge,
    headless: true,
  })
  const context = await browser.newContext({
    viewport: { width: 1440, height: 880 },
  })
  context.setDefaultTimeout(15000)
  let stage = 'import'
  try {
    const setup = await context.newPage()
    await setup.goto(base.href)
    await setup
      .locator('input[type=file][aria-label="Import EPUBs or a Flow backup"]')
      .setInputFiles(await fixture())
    const listen = button(setup, 'Listen to ' + book)
    await listen.click()
    await setup
      .getByLabel('Through', { exact: true })
      .selectOption({ label: 'The Lighthouse' })
    const quiet = await openExcerpt(setup)
    const article = quietArticle(quiet)
    const html = await article.innerHTML()
    await article.evaluate((element) => {
      window.fixtureTextNode = element.querySelector('p em').firstChild
    })
    assert.equal(await quiet.locator('iframe').count(), 0)

    stage = 'excerpt navigation and appearance'
    await button(tools(quiet), 'Table of contents').click()
    assert.deepEqual(
      await panel(quiet).locator('li button').allTextContents(),
      ['The Harbor', 'The Lighthouse'],
    )
    await button(panel(quiet), 'The Lighthouse').click()
    await panel(quiet).waitFor({ state: 'hidden' })
    assert.equal(
      await article.evaluate((element) => document.activeElement === element),
      true,
    )
    await button(tools(quiet), 'Search').click()
    const search = panel(quiet).getByRole('searchbox', {
      name: 'Search listening text',
    })
    await search.fill('silver apple')
    await panel(quiet)
      .getByText('No matches in this listening selection.')
      .waitFor()
    await search.fill('compass beside')
    await panel(quiet).getByRole('status').getByText('1 match').waitFor()
    await panel(quiet)
      .getByRole('button', { name: /copper compass beside/ })
      .click()
    await panel(quiet).waitFor({ state: 'hidden' })
    await quiet.locator('.flow-quiet-marks > span').first().waitFor()
    await button(tools(quiet), 'Images').click()
    assert.equal(await button(panel(quiet), 'Orchard marker').count(), 0)
    await button(panel(quiet), 'Harbor marker').click()
    const image = panel(quiet)
      .getByRole('img', { name: 'Harbor marker' })
      .last()
    await image.waitFor()
    await image.evaluate((element) => element.decode())
    await panel(quiet).getByText('Harbor marker caption').waitFor()
    await button(panel(quiet), 'Go to passage').click()
    await panel(quiet).waitFor({ state: 'hidden' })
    await button(tools(quiet), 'Reading timeline').click()
    await panel(quiet)
      .getByRole('slider', { name: 'Viewed position' })
      .waitFor()
    await button(panel(quiet), 'The Harbor').click()
    await panel(quiet).waitFor({ state: 'hidden' })
    await button(tools(quiet), 'Typography').click()
    await panel(quiet).getByLabel('Text size', { exact: true }).fill('30')
    await quiet.waitForFunction(
      () =>
        getComputedStyle(document.querySelector('.flow-quiet-article'))
          .fontSize === '30px',
    )
    await panel(quiet).getByLabel('Font', { exact: true }).selectOption('sans')
    await panel(quiet).getByLabel('Line spacing', { exact: true }).fill('1.9')
    await panel(quiet).getByLabel('Text width', { exact: true }).fill('55')
    await quiet.waitForFunction(() => {
      const main = document.querySelector('.flow-quiet')
      return (
        main.style.getPropertyValue('--quiet-text-width') === '55ch' &&
        main.style.getPropertyValue('--quiet-line-height') === '1.9' &&
        main.style.getPropertyValue('--quiet-font-family').includes('Segoe UI')
      )
    })
    await button(tools(quiet), 'Theme').click()
    await panel(quiet)
      .getByRole('radio', { name: 'sepia', exact: true })
      .check()
    await quiet.waitForFunction(
      () => document.querySelector('main').dataset.quietTheme === 'sepia',
    )
    await closePanel(quiet)
    assert.equal(
      await article.innerHTML(),
      html,
      'Tool actions must keep narration markup stable',
    )
    console.log(
      'PASS  excerpt-only Contents, Search, Images and Timeline, plus live Typography and Theme',
    )

    stage = 'listening annotation save and original reader live updates'
    const original = await context.newPage()
    await original.goto(base.href)
    await original
      .getByRole('button', { name: 'Read ' + book, exact: true })
      .last()
      .click()
    const originalText = original
      .frameLocator('iframe')
      .first()
      .locator('p')
      .filter({ hasText: 'copper' })
    await originalText.waitFor()
    const copper = article.locator('p').filter({ hasText: 'copper' })
    await selectText(copper, passage)
    await button(
      quiet.getByRole('group', { name: 'Listening text selection' }),
      'Add note',
    ).click()
    await panel(quiet).getByLabel('Note', { exact: true }).fill(note)
    await button(panel(quiet), 'Save annotation').click()
    await panel(quiet).getByText(note, { exact: true }).waitFor()
    await markRects(quiet).first().waitFor()
    await original.locator('.epubjs-hl').first().waitFor({ state: 'attached' })
    await closePanel(quiet)
    await quiet.getByRole('button', { name: 'Open note on ' + passage }).click()
    assert.equal(
      await panel(quiet).getByLabel('Note', { exact: true }).inputValue(),
      note,
    )
    await screenshot(quiet, 'listening-note.png')
    await closePanel(quiet)
    assert.equal(await article.innerHTML(), html)
    assert.equal(
      await article.evaluate(
        (element) =>
          window.fixtureTextNode === element.querySelector('p em').firstChild,
      ),
      true,
    )

    stage = 'update the note and create a highlight from the EPUB reader'
    await selectText(originalText, passage)
    const originalNote = original.locator('textarea[name=notes]')
    await originalNote.waitFor()
    assert.equal(await originalNote.inputValue(), note)
    await originalNote.fill(edited)
    await button(original, 'Update').click()
    await originalNote.waitFor({ state: 'hidden' })
    await button(tools(quiet), 'Annotations').click()
    await panel(quiet).getByText(edited, { exact: true }).waitFor()
    await closePanel(quiet)
    const duplicate = original
      .frameLocator('iframe')
      .first()
      .getByText('The tide is turning.', { exact: true })
      .last()
    await selectText(duplicate, 'tide is turning')
    await button(original, 'Highlight in blue').click()
    await button(tools(quiet), 'Annotations').click()
    const duplicateRow = panel(quiet)
      .getByRole('button', { name: /tide is turning/i })
      .first()
    await duplicateRow.waitFor()
    await quiet.waitForFunction(() => {
      const repetitions = Array.from(
        document.querySelectorAll('.flow-quiet-article p'),
      ).filter((item) => item.textContent === 'The tide is turning.')
      const mark = Array.from(
        document.querySelectorAll('[data-listening-highlight]'),
      ).at(-1)
      return (
        mark &&
        mark.getBoundingClientRect().top >=
          repetitions.at(-1).getBoundingClientRect().top - 4
      )
    })
    await duplicateRow.click()
    assert.equal(await article.innerHTML(), html)
    console.log(
      'PASS  original EPUB has a listening-created highlight and note, and quiet view reflects EPUB edits and new highlights',
    )

    stage = 'new session, deletion, and range clipping'
    const harborSection = article.locator('[data-flow-quiet-section]').first()
    await selectText(harborSection, 'still damp.Begin the next')
    await button(
      quiet.getByRole('group', { name: 'Listening text selection' }),
      'Highlight',
    ).click()
    await button(tools(quiet), 'Annotations').click()
    await panel(quiet)
      .getByRole('button', { name: /^The Harbor still damp\.Begin the next/i })
      .waitFor()
    await closePanel(quiet)

    const lighthouseText = article.getByText(/look for the amber lantern/i)
    await selectText(lighthouseText, 'amber lantern')
    await button(
      quiet.getByRole('group', { name: 'Listening text selection' }),
      'Highlight',
    ).click()
    await button(tools(quiet), 'Annotations').click()
    await panel(quiet)
      .getByRole('button', { name: /the lighthouse amber lantern/i })
      .waitFor()
    await closePanel(quiet)

    const reopened = await openExcerpt(setup)
    assert.equal(
      await reopened.locator('main').getAttribute('data-quiet-theme'),
      'sepia',
    )
    await reopened
      .getByRole('button', { name: 'Open note on ' + passage })
      .click()
    assert.equal(
      await panel(reopened).getByLabel('Note', { exact: true }).inputValue(),
      edited,
    )
    await button(panel(reopened), 'Delete annotation').click()
    await panel(reopened)
      .getByText(edited, { exact: true })
      .waitFor({ state: 'hidden' })
    await original.waitForFunction(
      () => document.querySelectorAll('.epubjs-hl').length === 2,
    )
    await closePanel(reopened)
    await reopened
      .getByRole('button', {
        name: new RegExp('^Bookmark in The Harbor: ' + bookmark),
      })
      .click()
    await reopened
      .getByText('Saved for your next session', { exact: true })
      .waitFor()
    await button(tools(reopened), 'Home').click()
    const resume = button(reopened, 'Resume listening to ' + book)
    await resume.waitFor()
    await resume.click()
    await quietArticle(reopened).waitFor()
    assert.equal(
      await quietArticle(reopened).locator('p').first().innerText(),
      bookmark,
    )
    await button(tools(reopened), 'Annotations').click()
    assert.equal(
      await panel(reopened).getByText(edited, { exact: true }).count(),
      0,
    )
    await panel(reopened)
      .getByRole('button', { name: /tide is turning/i })
      .first()
      .waitFor()
    const clipped = panel(reopened).getByRole('button', {
      name: 'The Harbor Begin the next',
      exact: true,
    })
    await clipped.waitFor()
    await button(panel(reopened), 'Edit annotation on Begin the next').click()
    assert.equal(
      await panel(reopened).locator('blockquote').innerText(),
      'Begin the next',
    )
    await button(panel(reopened), 'Cancel').click()
    assert.equal(
      await panel(reopened)
        .getByRole('button', { name: /still damp/i })
        .count(),
      0,
    )
    await panel(reopened)
      .getByRole('button', { name: /the lighthouse amber lantern/i })
      .waitFor()
    await reopened.setViewportSize({ width: 390, height: 844 })
    assert.equal(
      await reopened.evaluate(() => document.documentElement.scrollWidth),
      390,
    )
    await screenshot(reopened, 'listening-annotations-narrow.png')
    await closePanel(reopened)
    await button(tools(reopened), 'Settings').click()
    const showBookmarks = panel(reopened).getByRole('checkbox', {
      name: 'Show paragraph Bookmark buttons',
    })
    await showBookmarks.uncheck()
    await panel(reopened)
      .getByText('Listening preferences saved.', { exact: true })
      .waitFor()
    await reopened
      .locator('.flow-quiet-bookmark')
      .first()
      .waitFor({ state: 'detached' })
    await reopened.reload()
    await quietArticle(reopened).waitFor()
    assert.equal(await reopened.locator('.flow-quiet-bookmark').count(), 0)
    await button(tools(reopened), 'Settings').click()
    await panel(reopened)
      .getByRole('link', { name: 'Edit listening range' })
      .click()
    await button(reopened, 'Open listening view').waitFor()
    console.log(
      'PASS  new sessions regenerate persisted marks, deletes propagate, Home resumes from the Bookmark, Settings persist and link to range setup',
    )
    console.log('Edge', browser.version())
  } catch (error) {
    throw new Error('Failed during ' + stage, { cause: error })
  } finally {
    await browser.close()
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
