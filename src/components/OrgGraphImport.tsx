import { useState, type FormEvent } from 'react'
import { Modal, Button } from './ui'
import type { OrgGraph } from '../lib/orgGraphJson'
import { maxOrgGraphBytes } from '../lib/reviewGraph'

const example = {
  nodes: [
    { id: 'sam', name: 'Sam Lee', type: 'User', department: 'Support', description: 'Support specialist' },
    { id: 'tickets', name: 'Support Tickets', type: 'Resource', department: 'Support', sensitivity: 'low', description: 'Support ticket queue' },
  ],
  edges: [{ id: 'sam-read-tickets', sourceId: 'sam', targetId: 'tickets', relation: 'GRANTS_READ', label: 'Read tickets' }],
} satisfies OrgGraph

export function OrgGraphImport({ canSubmit, onClose, onImport }: {
  canSubmit: boolean
  onClose: () => void
  onImport: (payload: Record<string, unknown>) => Promise<void>
}) {
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const [reading, setReading] = useState(false)
  const [busy, setBusy] = useState(false)

  async function loadFile(file?: File) {
    if (!file) return
    setError('')
    if (!file.name.toLowerCase().endsWith('.json')) {
      setError('Choose a .json file.')
      return
    }
    if (file.size > maxOrgGraphBytes) {
      setError('Graph JSON must be under 4 MiB.')
      return
    }
    setReading(true)
    try {
      setText(await file.text())
    } catch {
      setError('The file could not be read. Paste its JSON instead.')
    } finally {
      setReading(false)
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || reading || !canSubmit) return
    setError('')
    if (new Blob([text]).size > maxOrgGraphBytes) {
      setError('Graph JSON must be under 4 MiB.')
      return
    }
    let payload: unknown
    try {
      payload = JSON.parse(text)
    } catch {
      setError('Enter valid JSON with nodes and edges arrays.')
      return
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      setError('The graph must be a JSON object with nodes and edges arrays.')
      return
    }
    setBusy(true)
    try {
      await onImport(payload as Record<string, unknown>)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The graph could not be imported.')
    } finally {
      setBusy(false)
    }
  }

  return <Modal open onClose={() => { if (!busy) onClose() }} size="lg">
    <Modal.Header>
      <Modal.Title>Import IAM graph</Modal.Title>
      <Modal.Description>Replace the shared graph with up to 80 nodes and 200 edges. Pending proposals for removed or changed relationships will be cleared. Reset Demo Org restores Kestrel Cloud anytime.</Modal.Description>
    </Modal.Header>
    <form className="flex min-h-0 flex-col" onSubmit={submit} aria-busy={busy}>
      <Modal.Body className="space-y-3">
        <label className="grid gap-1 text-sm">Choose a JSON file
          <input type="file" accept=".json,application/json" disabled={busy || reading} onChange={event => {
            void loadFile(event.currentTarget.files?.[0])
            event.currentTarget.value = ''
          }} />
        </label>
        <Button type="button" variant="outline" disabled={busy || reading} onClick={() => {
          setText(JSON.stringify(example, null, 2))
          setError('')
        }}>Load minimal example JSON</Button>
        <label className="grid gap-1 text-sm">Graph JSON
          <textarea rows={11} spellCheck={false} value={text} disabled={busy || reading}
            className="w-full rounded-md border border-border bg-background p-3 font-mono text-xs"
            placeholder={'{ "nodes": [], "edges": [] }'} onChange={event => {
              setText(event.target.value)
              setError('')
            }} />
        </label>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      </Modal.Body>
      <Modal.Footer>
        <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>Cancel</Button>
        <Button type="submit" loading={busy} disabled={!canSubmit || busy || reading || !text.trim()}>Replace workspace graph</Button>
      </Modal.Footer>
    </form>
  </Modal>
}
