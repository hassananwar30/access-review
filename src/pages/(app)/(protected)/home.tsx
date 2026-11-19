import { Suspense, lazy, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { getAuthToken, useAuthProfileReady, useMutations, usePresenceRoom, useQuery, useUsers } from 'deepspace'
import { Users } from 'lucide-react'
import { SCOPE_ID } from '../../../constants'
import { ReviewSimulator } from '../../../components/ReviewSimulator'
import { graphFromRecords, type EdgeRecord, type NodeRecord } from '../../../lib/reviewGraph'
import { simulateEdgeRemoval } from '../../../lib/accessGraph'

const ChatPanel = lazy(() => import('../../../components/ChatPanel').then(module => ({ default: module.ChatPanel })))
const advisorPrompts = [
  'How do I fully remove Dana Patel’s access to prod-payments-db?',
  'Which single edge removal would break a production service account?',
  'Find users with shadow admin paths to critical resources.',
]
const roleLabels = { admin: 'Admin / IAM Approver', member: 'Member / Security Engineer', viewer: 'Viewer / Auditor' }

async function action<T>(name: string, params: Record<string, unknown>): Promise<T> {
  const token = await getAuthToken()
  if (!token) throw new Error('Sign in to continue.')
  const response = await fetch(`/api/actions/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(params),
  })
  const reply = await response.json().catch(() => null) as
    | { success: true; data: T }
    | { success: false; error?: string }
    | null
  if (!response.ok || !reply?.success) {
    const message = reply?.success === false ? reply.error : undefined
    throw new Error(message ?? 'The request could not be completed.')
  }
  return reply.data
}

type WriteAction = (name: string, params: Record<string, unknown>, message: string) => Promise<boolean>
interface Proposal {
  title: string
  rationale: string
  edgeIdsJson: string
  blastSummaryJson: string
  status: 'pending' | 'approved' | 'rejected'
  reviewNote?: string
}
interface Comment { proposalId: string; authorId: string; body: string }
interface Audit { action: string; actorId: string; timestamp: string; targetEdgeIdsJson: string; blastSummaryJson: string }

function summaryText(json: string) {
  const summary: Partial<ReturnType<typeof simulateEdgeRemoval>['summary']> = JSON.parse(json)
  if (summary.principalsImpacted === undefined) return ''
  return `${summary.accessLostCount} lost · ${summary.shadowAccessCount} retained · ${summary.downgradedCount} downgraded`
}

function ProposalRow({ id, proposal, canReview, canComment, ready, run, edgeLabels }: {
  id: string; proposal: Proposal; canReview: boolean; canComment: boolean; ready: boolean; run: WriteAction
  edgeLabels: ReadonlyMap<string, string>
}) {
  const { records: comments } = useQuery<Comment>('proposal_comments', { where: { proposalId: id } })
  const { users } = useUsers()
  const commentMutation = useMutations<{ proposalId: string; body: string }>('proposal_comments')
  const [body, setBody] = useState('')
  const [reason, setReason] = useState('')
  const [posting, setPosting] = useState(false)
  const [commentError, setCommentError] = useState('')

  async function postComment(event: FormEvent) {
    event.preventDefault()
    if (posting || !commentMutation.ready || !body.trim()) return
    setPosting(true)
    setCommentError('')
    try {
      await commentMutation.createConfirmed({ proposalId: id, body: body.trim() })
      setBody('')
    } catch (error) {
      setCommentError(error instanceof Error ? error.message : 'The comment could not be saved.')
    } finally {
      setPosting(false)
    }
  }

  return <article data-testid="revocation-proposal">
    <details open={proposal.status === 'pending'}>
      <summary><strong>{proposal.title}</strong> · {proposal.status}</summary>
      <p>{proposal.rationale}</p>
      <ul className="review-muted">{(JSON.parse(proposal.edgeIdsJson) as string[]).map(edgeId =>
        <li key={edgeId}>{edgeLabels.get(edgeId) ?? edgeId}</li>)}</ul>
      <p className="review-muted">{summaryText(proposal.blastSummaryJson)}</p>
      {proposal.reviewNote && <p>Decision note · {proposal.reviewNote}</p>}
      {canReview && proposal.status === 'pending' && <div className="review-form">
        <label>Decision note<textarea value={reason} onChange={event => setReason(event.target.value)} maxLength={4000} /></label>
        <div className="review-tabs">
          <button type="button" className="review-button review-primary" disabled={!ready} onClick={() =>
            void run('applyRevocation', { proposalId: id, reason }, 'Approved and applied.')}>Approve &amp; Apply</button>
          <button type="button" className="review-button" disabled={!ready || !reason.trim()} onClick={() =>
            void run('rejectProposal', { proposalId: id, reason }, 'Proposal rejected.')}>Reject</button>
        </div>
      </div>}
      {comments.map(({ recordId, data }) => <p key={recordId} className="review-muted">
        {users.find(user => user.id === data.authorId)?.name ?? data.authorId} · {data.body}
      </p>)}
      {commentError && <p role="alert" className="review-error">{commentError}</p>}
      {canComment && <form className="review-form" onSubmit={postComment}>
        <label>Comment<textarea value={body} onChange={event => setBody(event.target.value)} maxLength={2000} /></label>
        <div><button className="review-button" disabled={posting || !commentMutation.ready || !body.trim()} type="submit">Post comment</button></div>
      </form>}
    </details>
  </article>
}

function Guidance({ topic }: { topic: string }) {
  const [links, setLinks] = useState<{ title: string; url: string }[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function search() {
    setBusy(true)
    setError('')
    try {
      const response = await action<{ links: { title: string; url: string }[] }>('findGuidance', { topic })
      setLinks(response.links)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Guidance unavailable.')
    } finally {
      setBusy(false)
    }
  }
  return <div className="review-guidance">
    <button type="button" className="review-button" disabled={busy} onClick={() => void search()}>{busy ? 'Searching…' : 'Find official guidance'}</button>
    {error && <p role="alert">{error}</p>}
    {links?.length === 0 && <p>No official links found for this scenario.</p>}
    {links?.map(link => <p key={link.url}><a href={link.url} target="_blank" rel="noreferrer">{link.title}</a></p>)}
  </div>
}

export default function ReviewWorkspace() {
  const [search] = useSearchParams()
  const { user } = useAuthProfileReady({ requireUser: true })
  const role = user?.role === 'admin' || user?.role === 'member' ? user.role : 'viewer'
  const canWrite = role !== 'viewer'
  const { records: nodeRecords, status } = useQuery<NodeRecord>('graph_nodes')
  const { records: edgeRecords, status: edgeStatus } = useQuery<EdgeRecord>('graph_edges')
  const { records: proposals } = useQuery<Proposal>('revocation_proposals', { orderBy: 'createdAt', orderDir: 'desc' })
  const { records: audit } = useQuery<Audit>('audit_logs', { orderBy: 'createdAt', orderDir: 'desc' })
  const { ready } = useMutations('revocation_proposals')
  const { peers, connected, updateState } = usePresenceRoom(`${SCOPE_ID}:access-review`)
  const [selection, setSelection] = useState(() => [...new Set(search.getAll('edge'))].slice(0, 100))
  const [tab, setTab] = useState<'proposals' | 'audit'>('proposals')
  const [showProposal, setShowProposal] = useState(false)
  const [showAdvisor, setShowAdvisor] = useState(false)
  const [chatId, setChatId] = useState<string | null>(null)
  const [feedback, setFeedback] = useState({ message: '', error: false })
  const [busy, setBusy] = useState(false)
  const graph = useMemo(() => graphFromRecords(nodeRecords, edgeRecords), [nodeRecords, edgeRecords])
  const selected = useMemo(() => selection.filter(id => graph.edges.some(edge => edge.id === id)), [selection, graph.edges])
  const selectedMetadata = JSON.stringify(selected.slice(0, 10))
  useEffect(() => { if (connected) updateState({ selection: selectedMetadata }) }, [connected, updateState, selectedMetadata])
  const impact = useMemo(() => simulateEdgeRemoval(graph.nodes, graph.edges, selected).summary, [graph, selected])
  const topic = impact.serviceAccountsBroken || impact.serviceAccountsDowngraded ? 'serviceAccount'
    : impact.shadowAccessCount ? 'shadowPath' : impact.downgradedCount ? 'downgrade' : 'revocation'
  const names = new Map(graph.nodes.map(node => [node.id, node.name]))
  const edgeLabels = new Map(edgeRecords.map(({ data: edge }) =>
    [edge.edgeKey, `${names.get(edge.sourceKey) ?? edge.sourceKey} → ${names.get(edge.targetKey) ?? edge.targetKey}`]))

  const run: WriteAction = async (name, params, message) => {
    if (busy || !ready) return false
    setBusy(true)
    setFeedback({ message: '', error: false })
    try {
      await action(name, params)
      setFeedback({ message, error: false })
      return true
    } catch (cause) {
      setFeedback({ message: cause instanceof Error ? cause.message : 'The action failed.', error: true })
      return false
    } finally {
      setBusy(false)
    }
  }

  async function propose(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    if (await run('createRevocationProposal', { title: form.get('title'), rationale: form.get('rationale'), edgeIds: selected }, 'Proposal submitted.')) {
      setShowProposal(false)
      setTab('proposals')
    }
  }

  const graphReady = status === 'ready' && edgeStatus === 'ready'
  return <main className="review-page">
    <div className="review-shell">
      <header className="review-mast">
        <Link to="/" className="review-button">Public demo</Link>
        <span className="review-live"><Users size={14} className="inline" /> {connected ? `${peers.length + 1} online` : 'Connecting presence…'}</span>
        <span className="review-muted">{roleLabels[role]}</span>
        {role === 'admin' && <button type="button" className="review-button" disabled={!ready || busy || !graphReady}
          onClick={() => void run('resetDemoOrg', {}, 'Kestrel Cloud restored.')}>Reset Demo Org</button>}
      </header>
      <div className="review-hero">
        <h1>Kestrel Cloud access review</h1>
        <p>Simulate a permission change, then submit the proposed revocation for approval.</p>
        {peers.map(peer => {
          let ids: unknown = []
          try { ids = JSON.parse(String(peer.state.selection ?? '[]')) } catch { /* Ignore malformed peer state. */ }
          const labels = Array.isArray(ids) ? ids.slice(0, 10).flatMap(id => typeof id === 'string' && edgeLabels.has(id) ? [edgeLabels.get(id)] : []) : []
          return <p className="review-live" key={peer.userId}>{peer.userName}{labels.length ? ` is simulating ${labels.join(', ')}` : ' is viewing the workspace'}</p>
        })}
      </div>
      {feedback.message && <p className={feedback.error ? 'review-error' : 'review-live'} role={feedback.error ? 'alert' : 'status'}>{feedback.message}</p>}
      {!graphReady ? <p>{status === 'error' || edgeStatus === 'error' ? 'Could not load the graph.' : 'Loading the workspace…'}</p>
        : graph.nodes.length === 0 ? <p>{role === 'admin' ? 'Select Reset Demo Org to load Kestrel Cloud.' : 'An admin needs to load the Kestrel Cloud graph.'}</p>
        : <ReviewSimulator {...graph} selected={selected} onSelection={setSelection}
          guidance={<Guidance key={topic} topic={topic} />}
          footer={<div className="review-footer">
            {canWrite ? <button type="button" className="review-button review-primary" disabled={!ready || busy || !selected.length} onClick={() => setShowProposal(open => !open)}>Propose Revocation</button>
              : <p>Only members and admins can propose revocations.</p>}
            {canWrite && showProposal && selected.length > 0 && <form className="review-form" onSubmit={propose}>
              <label>Proposal title<input name="title" maxLength={160} required /></label>
              <label>Rationale<textarea name="rationale" maxLength={4000} required /></label>
              <button className="review-button review-primary" type="submit" disabled={busy || !ready}>Submit proposal</button>
            </form>}
          </div>} />}
      <section className="review-panel review-collab">
        <div className="review-tabs">
          <button type="button" className="review-button" aria-pressed={tab === 'proposals'} onClick={() => setTab('proposals')}>Proposals</button>
          <button type="button" className="review-button" aria-pressed={tab === 'audit'} onClick={() => setTab('audit')}>Audit Log</button>
          <button type="button" className="review-button" aria-expanded={showAdvisor} onClick={() => setShowAdvisor(open => !open)}>Least-Privilege Advisor</button>
        </div>
        {tab === 'proposals' ? (
          proposals.length ? proposals.map(({ recordId, data }) => <ProposalRow key={recordId} id={recordId} proposal={data}
            canReview={role === 'admin'} canComment={canWrite} ready={ready && !busy} run={run} edgeLabels={edgeLabels} />) : <p className="review-muted">No proposals yet.</p>
        ) : (
          audit.length ? audit.map(({ recordId, data }) => <article key={recordId} data-testid="audit-entry" data-record-id={recordId}>
            <strong>{data.action}</strong><p className="review-muted">{data.actorId} · {new Date(data.timestamp).toLocaleString()}</p>
            <ul className="review-muted">{(JSON.parse(data.targetEdgeIdsJson) as string[]).map(edgeId =>
              <li key={edgeId}>{edgeLabels.get(edgeId) ?? edgeId}</li>)}</ul>
            <p>{summaryText(data.blastSummaryJson)}</p>
          </article>) : <p className="review-muted">No audit entries yet.</p>
        )}
      </section>
      {showAdvisor && user?.id && <section className="review-panel review-collab" aria-label="Least-Privilege Advisor">
        <Suspense fallback={<p>Loading advisor…</p>}>
          <ChatPanel userId={user.id} chatId={chatId} onChatCreated={setChatId} emptyStatePrompts={advisorPrompts} className="h-[460px]" />
        </Suspense>
      </section>}
    </div>
  </main>
}
