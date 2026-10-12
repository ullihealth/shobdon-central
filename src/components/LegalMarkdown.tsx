import type { JSX } from 'react'

// Dependency-free renderer for exactly the markdown subset the legal
// documents in src/content/legalTerms.ts actually use - no markdown
// library exists anywhere in this project's dependencies (confirmed
// before writing this), and pulling one in for three fixed, known-
// structure legal documents would be a lot of surface area (and a new
// top-level dependency) for content that never needs to render arbitrary
// user markdown. Handles: ## and ### headings, bullet lists (- ), real
// ordered lists (single "N. " marker, e.g. Schedule 1's S4.1 list and
// Part C's six numbered clauses), numbered CLAUSE paragraphs (the "N.M "
// style used throughout Part A/B, e.g. "1.1 ...", which is prose, not a
// list, and must not be renumbered or bulleted), inline **bold**, and
// GitHub-style pipe tables (Part B's data-use table). Nothing else -
// this is intentionally narrow, not a general CommonMark implementation.

function renderInline(text: string, keyPrefix: string): (string | JSX.Element)[] {
  const parts = text.split(/(\*\*[^*]+\*\*)/g)
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={`${keyPrefix}-${i}`}>{part.slice(2, -2)}</strong>
    }
    return part
  })
}

// "1. ", "2. " - a bare integer marker with nothing before the dot. Only
// matches when NOT immediately followed by another digit, so a clause
// number like "1.1 " or "17.1 " (prose, not a list - this content's
// decimal-numbered clauses) falls through to the plain-paragraph case
// below instead of being mistaken for a list item.
const ORDERED_ITEM = /^(\d+)\.\s(?!\d)(.*)$/
const BULLET_ITEM = /^-\s(.*)$/
const TABLE_ROW = /^\|(.+)\|$/
// Matches "| --- | --- | --- |" style separator rows. The character
// class must include | itself (a multi-column separator has one pipe
// PER column boundary, not just a leading/trailing pair) - an earlier
// version of this regex omitted it, which meant the separator row for
// any table with more than one column silently fell through and
// rendered as a literal data row instead of being skipped (caught via
// screenshot review of the real Privacy Policy table, which has five
// columns).
const TABLE_SEPARATOR = /^\|[\s:|-]+\|$/

interface Block {
  type: 'h2' | 'h3' | 'p' | 'ol' | 'ul' | 'table'
  text?: string
  items?: { n?: number; text: string }[]
  rows?: string[][]
}

function parseBlocks(markdown: string): Block[] {
  const lines = markdown.split('\n')
  const blocks: Block[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    if (line.trim() === '') {
      i++
      continue
    }

    if (line.startsWith('### ')) {
      blocks.push({ type: 'h3', text: line.slice(4) })
      i++
      continue
    }
    if (line.startsWith('## ')) {
      blocks.push({ type: 'h2', text: line.slice(3) })
      i++
      continue
    }

    if (TABLE_ROW.test(line)) {
      const rows: string[][] = []
      while (i < lines.length && TABLE_ROW.test(lines[i])) {
        if (!TABLE_SEPARATOR.test(lines[i])) {
          const cells = lines[i]
            .slice(1, -1)
            .split('|')
            .map((c) => c.trim())
          rows.push(cells)
        }
        i++
      }
      blocks.push({ type: 'table', rows })
      continue
    }

    const orderedMatch = line.match(ORDERED_ITEM)
    if (orderedMatch) {
      const items: { n?: number; text: string }[] = []
      while (i < lines.length) {
        const m = lines[i].match(ORDERED_ITEM)
        if (!m) break
        items.push({ n: Number(m[1]), text: m[2] })
        i++
      }
      blocks.push({ type: 'ol', items })
      continue
    }

    const bulletMatch = line.match(BULLET_ITEM)
    if (bulletMatch) {
      const items: { text: string }[] = []
      while (i < lines.length) {
        const m = lines[i].match(BULLET_ITEM)
        if (!m) break
        items.push({ text: m[1] })
        i++
      }
      blocks.push({ type: 'ul', items })
      continue
    }

    // Plain paragraph - collects this line and any immediately
    // following non-blank, non-structural lines (clause paragraphs like
    // "1.1 ..." fall through to here too, rendered as-is with their own
    // leading number as part of the text).
    const paragraphLines: string[] = []
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !lines[i].startsWith('## ') &&
      !lines[i].startsWith('### ') &&
      !TABLE_ROW.test(lines[i]) &&
      !ORDERED_ITEM.test(lines[i]) &&
      !BULLET_ITEM.test(lines[i])
    ) {
      paragraphLines.push(lines[i])
      i++
    }
    blocks.push({ type: 'p', text: paragraphLines.join(' ') })
  }

  return blocks
}

export default function LegalMarkdown({ markdown }: { markdown: string }): JSX.Element {
  const blocks = parseBlocks(markdown)

  return (
    <div className="space-y-4 text-sm leading-relaxed text-slate-300">
      {blocks.map((block, i) => {
        const key = `block-${i}`
        if (block.type === 'h2') {
          return (
            <h2 key={key} className="mt-8 text-xl font-bold text-slate-100 first:mt-0">
              {renderInline(block.text ?? '', key)}
            </h2>
          )
        }
        if (block.type === 'h3') {
          return (
            <h3 key={key} className="mt-6 text-base font-bold text-slate-100 first:mt-0">
              {renderInline(block.text ?? '', key)}
            </h3>
          )
        }
        if (block.type === 'ol') {
          return (
            <ol key={key} className="list-none space-y-2 pl-0">
              {(block.items ?? []).map((item, j) => (
                <li key={j} className="flex gap-2">
                  <span className="shrink-0 font-semibold text-slate-400">{item.n}.</span>
                  <span>{renderInline(item.text, `${key}-${j}`)}</span>
                </li>
              ))}
            </ol>
          )
        }
        if (block.type === 'ul') {
          return (
            <ul key={key} className="list-disc space-y-1 pl-5">
              {(block.items ?? []).map((item, j) => (
                <li key={j}>{renderInline(item.text, `${key}-${j}`)}</li>
              ))}
            </ul>
          )
        }
        if (block.type === 'table') {
          const [header, ...body] = block.rows ?? []
          return (
            <div key={key} className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-700">
                    {header?.map((cell, j) => (
                      <th key={j} className="p-2 font-semibold text-slate-200">
                        {cell}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {body.map((row, r) => (
                    <tr key={r} className="border-b border-slate-800 align-top">
                      {row.map((cell, c) => (
                        <td key={c} className="p-2 text-slate-400">
                          {cell}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
        return <p key={key}>{renderInline(block.text ?? '', key)}</p>
      })}
    </div>
  )
}
