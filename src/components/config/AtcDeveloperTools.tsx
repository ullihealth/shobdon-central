import { useState } from 'react'
import { testAtcConnection } from '../../services/atcDiagnostics'
import type { AtcConnectionTestResult } from '../../services/atcDiagnostics'
import {
  clearReferenceSample,
  loadReferenceSample,
  saveReferenceSample,
  REFERENCE_SAMPLE_FILENAME,
} from '../../services/atcReferenceSample'
import type { AtcReferenceSample } from '../../services/atcReferenceSample'
import { detectResponseFormat, formatBytes, toHexDump } from '../../utils/responseFormat'
import MetadataRow from './MetadataRow'

interface AtcDeveloperToolsProps {
  stationUrl: string
  connectionTimeoutMs: number
}

interface CaptureHistoryEntry {
  id: string
  retrievedAt: Date
  result: AtcConnectionTestResult
}

const MAX_HISTORY_ENTRIES = 5

const primaryButtonClassName =
  'rounded-lg bg-sky-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-50'

const secondaryButtonClassName =
  'rounded-lg border border-slate-700 bg-slate-900/80 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:border-sky-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-40'

function formatTimestamp(date: Date): string {
  return date.toLocaleString('en-GB')
}

function formatHistoryTime(date: Date): string {
  return date.toLocaleTimeString('en-GB')
}

function formatSampleTimestamp(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso))
}

export default function AtcDeveloperTools({ stationUrl, connectionTimeoutMs }: AtcDeveloperToolsProps): JSX.Element {
  const [result, setResult] = useState<AtcConnectionTestResult | null>(null)
  const [testing, setTesting] = useState(false)
  const [rawViewerOpen, setRawViewerOpen] = useState(false)
  const [copyLabel, setCopyLabel] = useState('Copy Response')
  const [autoCopy, setAutoCopy] = useState(false)
  const [history, setHistory] = useState<CaptureHistoryEntry[]>([])
  const [viewMode, setViewMode] = useState<'text' | 'hex'>('text')
  const [referenceSample, setReferenceSample] = useState<AtcReferenceSample | null>(() => loadReferenceSample())

  async function runTest() {
    setTesting(true)
    const next = await testAtcConnection(stationUrl, connectionTimeoutMs)
    setResult(next)
    setHistory((prev) => [{ id: crypto.randomUUID(), retrievedAt: next.retrievedAt, result: next }, ...prev].slice(0, MAX_HISTORY_ENTRIES))
    setTesting(false)

    if (autoCopy && next.ok && next.rawText) {
      navigator.clipboard.writeText(next.rawText)
      setCopyLabel('Copied!')
      window.setTimeout(() => setCopyLabel('Copy Response'), 1500)
    }
  }

  function handleCopy() {
    if (!result?.rawText) return
    navigator.clipboard.writeText(result.rawText)
    setCopyLabel('Copied!')
    window.setTimeout(() => setCopyLabel('Copy Response'), 1500)
  }

  function handleDownload() {
    if (!result?.rawText) return
    const blob = new Blob([result.rawText], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'weatherlink-response.txt'
    link.click()
    URL.revokeObjectURL(url)
  }

  function handleSaveSample() {
    if (!result?.rawText) return
    const sample: AtcReferenceSample = {
      rawText: result.rawText,
      contentType: result.contentType,
      capturedAt: new Date().toISOString(),
    }
    saveReferenceSample(sample)
    setReferenceSample(sample)
  }

  function handleClearSample() {
    clearReferenceSample()
    setReferenceSample(null)
  }

  function handleDownloadSample() {
    if (!referenceSample) return
    const blob = new Blob([referenceSample.rawText], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = REFERENCE_SAMPLE_FILENAME
    link.click()
    URL.revokeObjectURL(url)
  }

  const responseFormat = detectResponseFormat(result?.contentType ?? null, result?.rawText ?? null)
  const displayedText = result?.rawText
    ? viewMode === 'hex'
      ? toHexDump(result.rawText)
      : result.rawText
    : 'No response yet - run Test Connection or Refresh Response.'

  return (
    <div className="mt-10 rounded-2xl border border-dashed border-amber-700/50 bg-amber-950/10 p-8">
      <div className="mb-1 text-sm font-bold uppercase tracking-widest text-amber-500">Developer Tools</div>
      <p className="mb-6 text-sm text-slate-400">
        This section is intended only to assist implementation of the WeatherLink parser and may be removed or
        hidden once the parser has been completed.
      </p>

      <h4 className="mb-3 text-sm font-semibold uppercase tracking-widest text-slate-400">ATC Connection Test</h4>
      <div className="flex flex-wrap items-center gap-4">
        <button type="button" onClick={runTest} disabled={testing} className={primaryButtonClassName}>
          {testing ? 'Testing…' : 'Test Connection'}
        </button>
        <label className="flex items-center gap-2 text-sm text-slate-400">
          <input
            type="checkbox"
            checked={autoCopy}
            onChange={(event) => setAutoCopy(event.target.checked)}
            className="h-4 w-4 rounded border-slate-700 bg-slate-900 accent-sky-600"
          />
          Automatically copy response after successful fetch
        </label>
      </div>

      {result && (
        <div className="mt-5 flex flex-col text-sm">
          <MetadataRow
            label="Result"
            value={result.ok ? 'Success' : 'Failed'}
            valueClassName={result.ok ? 'text-green-400' : 'text-red-400'}
          />
          <MetadataRow label="HTTP Status" value={result.status !== null ? String(result.status) : '—'} />
          <MetadataRow label="Response Time" value={`${result.responseTimeMs} ms`} />
          <MetadataRow
            label="Response Size"
            value={result.responseSizeBytes !== null ? `${result.responseSizeBytes} bytes` : '—'}
          />
          <MetadataRow label="Content-Type" value={result.contentType ?? '—'} />
          <MetadataRow label="Time of Test" value={formatTimestamp(result.retrievedAt)} />
          {result.errorMessage && <MetadataRow label="Error" value={result.errorMessage} valueClassName="text-red-400" />}
        </div>
      )}

      {/* Raw Response Viewer */}
      <div className="mt-8 border-t border-amber-900/30 pt-6">
        <button
          type="button"
          onClick={() => setRawViewerOpen((open) => !open)}
          className="flex w-full items-center justify-between text-left text-sm font-semibold uppercase tracking-widest text-slate-400"
        >
          <span>Raw Weather Station Response</span>
          <span>{rawViewerOpen ? '▲' : '▼'}</span>
        </button>

        {rawViewerOpen && (
          <div className="mt-4 flex flex-col gap-4">
            {history.length > 0 && (
              <div className="flex flex-col gap-2">
                <h5 className="text-xs font-semibold uppercase tracking-widest text-slate-500">Capture History</h5>
                <div className="flex flex-col divide-y divide-slate-800 rounded-lg border border-slate-800">
                  {history.map((entry) => (
                    <button
                      key={entry.id}
                      type="button"
                      onClick={() => setResult(entry.result)}
                      className={`flex items-center justify-between px-3 py-1.5 text-left font-mono text-xs transition hover:bg-slate-800/60 ${
                        result === entry.result ? 'bg-slate-800/80 text-sky-300' : 'text-slate-400'
                      }`}
                    >
                      <span>{formatHistoryTime(entry.retrievedAt)}</span>
                      <span>
                        {entry.result.responseSizeBytes !== null ? formatBytes(entry.result.responseSizeBytes) : '—'}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-400">
                Response <span className="ml-1 rounded bg-slate-800 px-2 py-0.5 text-xs font-semibold text-sky-300">{responseFormat}</span>
              </span>

              <div className="flex items-center gap-4 text-sm text-slate-400">
                <span>View</span>
                <label className="flex items-center gap-1.5">
                  <input
                    type="radio"
                    name="atc-view-mode"
                    checked={viewMode === 'text'}
                    onChange={() => setViewMode('text')}
                    className="accent-sky-600"
                  />
                  Text
                </label>
                <label className="flex items-center gap-1.5">
                  <input
                    type="radio"
                    name="atc-view-mode"
                    checked={viewMode === 'hex'}
                    onChange={() => setViewMode('hex')}
                    className="accent-sky-600"
                  />
                  Hex
                </label>
              </div>
            </div>

            <textarea
              readOnly
              value={displayedText}
              className="h-64 w-full resize-y rounded-lg border border-slate-700 bg-slate-950 p-4 font-mono text-xs text-slate-300"
            />

            <div className="flex flex-wrap gap-3">
              <button type="button" onClick={runTest} disabled={testing} className={secondaryButtonClassName}>
                Refresh Response
              </button>
              <button
                type="button"
                onClick={handleCopy}
                disabled={!result?.rawText}
                className={secondaryButtonClassName}
              >
                {copyLabel}
              </button>
              <button
                type="button"
                onClick={handleDownload}
                disabled={!result?.rawText}
                className={secondaryButtonClassName}
              >
                Download Response
              </button>
              <button
                type="button"
                onClick={handleSaveSample}
                disabled={!result?.rawText}
                className={secondaryButtonClassName}
              >
                Save as Reference Sample
              </button>
            </div>

            <div className="flex flex-col text-sm">
              <h5 className="mb-2 text-xs font-semibold uppercase tracking-widest text-slate-500">
                Response Metadata
              </h5>
              <MetadataRow label="HTTP Status" value={result && result.status !== null ? String(result.status) : '—'} />
              <MetadataRow label="Content-Type" value={result?.contentType ?? '—'} />
              <MetadataRow label="Character Encoding" value={result?.characterEncoding ?? '—'} />
              <MetadataRow
                label="Response Length"
                value={result && result.responseSizeBytes !== null ? `${result.responseSizeBytes} bytes` : '—'}
              />
              <MetadataRow label="Retrieved At" value={result ? formatTimestamp(result.retrievedAt) : '—'} />
            </div>
          </div>
        )}
      </div>

      {/* Reference Sample */}
      <div className="mt-8 border-t border-amber-900/30 pt-6">
        <h4 className="mb-3 text-sm font-semibold uppercase tracking-widest text-slate-400">Reference Sample</h4>
        {referenceSample ? (
          <div className="flex flex-col gap-3 text-sm">
            <div className="flex flex-col">
              <span className="text-xs uppercase tracking-widest text-slate-500">Current Sample</span>
              <span className="font-mono text-slate-200">{REFERENCE_SAMPLE_FILENAME}</span>
              <span className="text-slate-500">Captured: {formatSampleTimestamp(referenceSample.capturedAt)}</span>
            </div>
            <div className="flex flex-wrap gap-3">
              <button type="button" onClick={handleDownloadSample} className={secondaryButtonClassName}>
                Download Sample
              </button>
              <button type="button" onClick={handleClearSample} className={secondaryButtonClassName}>
                Clear Sample
              </button>
            </div>
          </div>
        ) : (
          <p className="text-sm text-slate-500">
            No reference sample saved yet. Use "Save as Reference Sample" above to capture the canonical development
            sample.
          </p>
        )}
      </div>

      {/* Parser Status */}
      <div className="mt-8 border-t border-amber-900/30 pt-6">
        <h4 className="mb-3 text-sm font-semibold uppercase tracking-widest text-slate-400">Parser Status</h4>
        <div className="flex flex-col gap-2 text-slate-300">
          <div className="text-white">● Not Implemented</div>
          <div className="text-slate-600">○ Parsed Successfully</div>
          <div className="text-slate-600">○ Parse Failed</div>
        </div>
      </div>
    </div>
  )
}
