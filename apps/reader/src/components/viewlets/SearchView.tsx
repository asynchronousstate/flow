import { useState, useEffect, useMemo } from 'react'
import Highlighter from 'react-highlight-words'
import { VscCollapseAll, VscExpandAll } from 'react-icons/vsc'

import {
  useAction,
  useList,
  useMobile,
  useSetAction,
  useTranslation,
} from '@flow/reader/hooks'
import {
  flatTree,
  IMatch,
  useReaderSnapshot,
  reader,
} from '@flow/reader/models'

import { scale } from '../../platform'
import { TextField } from '../Form'
import { Row } from '../Row'
import { PaneViewProps, PaneView } from '../base'
import { searchExcerpt } from '../search-excerpt'

const SEARCH_ITEM_SIZE = scale(56, 72)
const searchScrollOffsets = new Map<string, number>()

// When inputting with IME and storing state in `valtio`,
// unexpected rendering with `e.target.value === ''` occurs,
// which leads to `<input>` and IME flash to empty,
// while this will not happen when using `React.useState`,
// so we should create an intermediate `keyword` state to fix this.
function useIntermediateKeyword() {
  const { focusedBookTab } = useReaderSnapshot()
  const [keyword, setKeyword] = useState(focusedBookTab?.keyword ?? '')

  useEffect(() => {
    setKeyword(focusedBookTab?.keyword ?? '')
  }, [focusedBookTab?.keyword])

  useEffect(() => {
    reader.focusedBookTab?.setKeyword(keyword)
  }, [keyword])

  return [keyword, setKeyword] as const
}

export const SearchView: React.FC<PaneViewProps> = (props) => {
  const [action] = useAction()
  const { focusedBookTab } = useReaderSnapshot()
  const t = useTranslation()

  const [keyword, setKeyword] = useIntermediateKeyword()

  const results = focusedBookTab?.results
  const expanded = results?.some((r) => r.expanded)

  return (
    <PaneView
      actions={[
        {
          id: expanded ? 'collapse-all' : 'expand-all',
          title: t(expanded ? 'action.collapse_all' : 'action.expand_all'),
          Icon: expanded ? VscCollapseAll : VscExpandAll,
          handle() {
            reader.focusedBookTab?.results?.forEach(
              (r) => (r.expanded = !expanded),
            )
          },
        },
      ]}
      {...props}
    >
      <div className="scroll-parent">
        <div className="px-5 py-px">
          <TextField
            as="input"
            name="keyword"
            aria-label="Search in this book"
            autoFocus={action === 'search'}
            hideLabel
            value={keyword}
            placeholder={t('search.title')}
            onChange={(e) => setKeyword(e.target.value)}
            onClear={() => setKeyword('')}
          />
        </div>
        {keyword && results && (
          <ResultList
            results={results as IMatch[]}
            keyword={keyword}
            bookId={focusedBookTab?.id ?? ''}
            visible={action === 'search'}
          />
        )}
      </div>
    </PaneView>
  )
}

interface ResultListProps {
  results: IMatch[]
  keyword: string
  bookId: string
  visible: boolean
}
const ResultList: React.FC<ResultListProps> = ({
  results,
  keyword,
  bookId,
  visible,
}) => {
  const rows = useMemo(
    () => results.flatMap((r) => flatTree(r)) ?? [],
    [results],
  )
  const { outerRef, innerRef, items } = useList(rows, SEARCH_ITEM_SIZE)
  const t = useTranslation('search')
  const positionKey = JSON.stringify([bookId, keyword])
  useEffect(() => {
    if (!visible) return
    const frame = requestAnimationFrame(() => {
      if (outerRef.current)
        outerRef.current.scrollTop = searchScrollOffsets.get(positionKey) ?? 0
    })
    return () => cancelAnimationFrame(frame)
  }, [visible, positionKey, outerRef])

  const sectionCount = results.length
  const resultCount = results.reduce((a, r) => r.subitems!.length + a, 0)

  return (
    <>
      <div className="typescale-body-small text-outline px-5  py-2">
        {t('files.result')
          .replace('{n}', '' + resultCount)
          .replace('{m}', '' + sectionCount)}
      </div>
      <div
        ref={outerRef}
        className="scroll"
        onScroll={(event) => {
          if (!visible) return
          searchScrollOffsets.set(positionKey, event.currentTarget.scrollTop)
          if (searchScrollOffsets.size > 30)
            searchScrollOffsets.delete(searchScrollOffsets.keys().next().value!)
        }}
      >
        <div ref={innerRef}>
          {items.map(({ index }) => (
            <ResultRow key={index} result={rows[index]} keyword={keyword} />
          ))}
        </div>
      </div>
    </>
  )
}

interface ResultRowProps {
  result?: IMatch
  keyword: string
}
const ResultRow: React.FC<ResultRowProps> = ({ result, keyword }) => {
  const mobile = useMobile()
  const setAction = useSetAction()
  if (!result) return null
  const { cfi, depth, expanded, subitems, id } = result
  let { excerpt, description } = result
  const tab = reader.focusedBookTab
  const isResult = depth === 1

  excerpt = searchExcerpt(excerpt, keyword)
  description = description?.trim()

  return (
    <Row
      className="flow-search-row"
      rowHeight={SEARCH_ITEM_SIZE}
      title={description ? `${description} / ${excerpt}` : excerpt}
      label={excerpt}
      description={description}
      depth={depth}
      active={tab?.activeResultID === id}
      expanded={expanded}
      subitems={subitems}
      badge={isResult}
      {...(!isResult && {
        onClick: () => {
          if (tab) {
            tab.activeResultID = id
            tab.display(cfi)
            if (mobile && !tab.runtimePolicy) setAction(undefined)
          }
        },
      })}
      toggle={() => tab?.toggleResult(id)}
    >
      {!isResult && (
        <Highlighter
          highlightClassName="match-highlight"
          searchWords={[keyword]}
          textToHighlight={excerpt}
          autoEscape
        />
      )}
    </Row>
  )
}
