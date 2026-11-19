import { useMemo, type ReactNode } from 'react'
import { AlertTriangle, ArrowRight, GitBranch, RotateCcw, ShieldCheck } from 'lucide-react'
import { simulateEdgeRemoval, type AccessPath, type GraphEdge, type GraphNode } from '../lib/accessGraph'
import { scenarios } from '../lib/reviewGraph'
import './review.css'

const columns = ['Principals', 'Groups', 'Roles', 'Resources']
const columnByType = { User: 0, ServiceAccount: 0, Group: 1, Role: 2, Resource: 3 }
const x = (column: number) => 14 + column * 227
const y = (row: number) => 43 + row * 40

interface SimulatorProps {
  nodes: readonly GraphNode[]
  edges: readonly GraphEdge[]
  selected: string[]
  onSelection: (selected: string[]) => void
  footer?: ReactNode
  guidance?: ReactNode
}

export function ReviewSimulator({ nodes, edges, selected, onSelection, footer, guidance }: SimulatorProps) {
  const result = useMemo(() => simulateEdgeRemoval(nodes, edges, selected), [nodes, edges, selected])
  const positions = useMemo(() => {
    const rows = [0, 0, 0, 0]
    return new Map(nodes.map(node => {
      const column = columnByType[node.type]
      return [node.id, { node, x: x(column), y: y(rows[column]++) }]
    }))
  }, [nodes])
  const canvasHeight = Math.max(220, ...[...positions.values()].map(pos => pos.y + 40))
  const broken = new Set([
    ...result.losesAccess, ...result.downgradedAccess, ...result.keepsAccessViaShadowPath,
  ].flatMap(change => change.brokenPaths.flatMap(path => path.edgeIds)))
  const shadow = new Set(result.keepsAccessViaShadowPath.flatMap(change => change.shadowPaths.flatMap(path => path.edgeIds)))
  const name = (id: string) => positions.get(id)?.node.name ?? id
  const toggle = (id: string) => onSelection(selected.includes(id) ? selected.filter(edgeId => edgeId !== id) : [...selected, id])

  function pathChain(path: AccessPath) {
    return <span className="review-path">{path.nodeIds.map(name).join(' → ')}</span>
  }

  return (
    <div className="review-grid">
      <section className="review-panel review-topology" aria-label="Permission graph">
        <div className="review-section-head">
          <div><h2><GitBranch size={18} /> Permission graph</h2><p>{nodes.length} identities and resources · {edges.length} active relationships</p></div>
          <button type="button" className="review-button" disabled={!selected.length} onClick={() => onSelection([])}><RotateCcw size={14} /> Clear</button>
        </div>
        <div className="review-scenarios">
          {scenarios.map(scenario => <button type="button" key={scenario.edgeId} className="review-button" disabled={!edges.some(edge => edge.id === scenario.edgeId)}
            aria-pressed={selected.length === 1 && selected[0] === scenario.edgeId}
            onClick={() => onSelection([scenario.edgeId])}>{scenario.name}</button>)}
        </div>
        {selected.length > 0 && <div className="review-legend" aria-label="Graph legend">
          <span className="cut">Selected for removal</span><span className="broken">Broken path</span><span className="shadow">Surviving path</span>
        </div>}
        <div className="review-canvas">
          <svg viewBox={`0 0 884 ${canvasHeight}`} style={{ minWidth: 680 }} aria-label="Click a relationship to simulate removing it">
            {columns.map((column, index) => <text key={column} x={x(index)} y={23} className="review-column">{column}</text>)}
            {[...edges].sort((a, b) => Number(selected.includes(a.id) || shadow.has(a.id)) - Number(selected.includes(b.id) || shadow.has(b.id))).map(edge => {
              const source = positions.get(edge.sourceId)
              const target = positions.get(edge.targetId)
              if (!source || !target) return null
              const same = source.x === target.x
              const startX = source.x + 178
              const endX = target.x + (same ? 178 : 0)
              const startY = source.y + 15
              const endY = target.y + 15
              const bend = same ? 35 : Math.max(25, (endX - startX) / 2)
              const d = `M ${startX} ${startY} C ${startX + bend} ${startY}, ${endX + (same ? bend : -bend)} ${endY}, ${endX} ${endY}`
              const active = selected.includes(edge.id)
              const cls = active ? 'cut' : shadow.has(edge.id) ? 'shadow' : broken.has(edge.id) ? 'broken' : ''
              const label = `${name(edge.sourceId)} → ${name(edge.targetId)}`
              return <g key={edge.id} className={`review-edge ${cls}`} role="button" tabIndex={0} aria-pressed={active} aria-label={label}
                onClick={() => toggle(edge.id)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggle(edge.id) } }}>
                <title>{label} · {edge.relation}</title><path className="review-edge-ink" d={d} /><path className="review-edge-hit" d={d} />
              </g>
            })}
            {[...positions].map(([id, pos]) => <g key={id} className={`review-node ${pos.node.type === 'ServiceAccount' ? 'bot' : ''}`}>
              <rect x={pos.x} y={pos.y} width={178} height={30} rx={5} />
              <circle cx={pos.x + 11} cy={pos.y + 15} r={3} />
              <text x={pos.x + 21} y={pos.y + 19}>{pos.node.name}</text>
              <title>{pos.node.description}</title>
            </g>)}
          </svg>
        </div>
        <label className="review-edge-picker">Add a relationship
          <select value="" onChange={event => toggle(event.target.value)}>
            <option value="" disabled>Choose an edge…</option>
            {edges.filter(edge => !selected.includes(edge.id)).map(edge => <option key={edge.id} value={edge.id}>{name(edge.sourceId)} → {name(edge.targetId)}</option>)}
          </select>
        </label>
        {selected.length > 0 && <div className="review-selection">
          {edges.filter(edge => selected.includes(edge.id)).map(edge => <button type="button" className="review-button" key={edge.id}
            onClick={() => toggle(edge.id)}>{name(edge.sourceId)} → {name(edge.targetId)} ×</button>)}
        </div>}
      </section>
      <aside className="review-panel review-inspector" aria-label="Blast radius">
        <div className="review-section-head"><div><h2><ShieldCheck size={18} /> Blast radius</h2><p>{selected.length ? `${selected.length} selected · ${result.summary.principalsImpacted} impacted` : 'Choose a scenario or select an edge.'}</p></div></div>
        {selected.length > 0 && <>
          <div className="review-stats" aria-live="polite">
            <span><strong>{result.summary.accessLostCount}</strong> Lost</span>
            <span><strong>{result.summary.shadowAccessCount}</strong> Retained</span>
            <span><strong>{result.summary.downgradedCount}</strong> Downgraded</span>
          </div>
          {(result.summary.serviceAccountsBroken > 0 || result.summary.serviceAccountsDowngraded > 0) &&
            <p role="alert" className="review-warning"><AlertTriangle size={17} /> Automation risk · {result.summary.serviceAccountsBroken} service accounts lose access and {result.summary.serviceAccountsDowngraded} are downgraded.</p>}
          {([
            ['Loses Access', result.losesAccess],
            ['Keeps Access (Shadow Path)', result.keepsAccessViaShadowPath],
            ['Downgraded Access', result.downgradedAccess],
          ] as const).map(([label, changes]) => changes.length > 0 && <section key={label} className="review-changes">
            <h3>{label}</h3>
            {changes.map(change => <details key={JSON.stringify([change.principalId, change.resourceId])} open={change.principalId === 'dana' || change.principalId === 'alex' || change.isServiceAccount}>
              <summary>{name(change.principalId)} <ArrowRight size={12} /> {name(change.resourceId)} <small>{change.beforeLevel} → {change.afterLevel}</small></summary>
              {change.brokenPaths.map(path => <div className="review-path-broken" key={path.edgeIds.join('|')}>Broken {pathChain(path)}</div>)}
              {('shadowPaths' in change ? change.shadowPaths : change.survivingPaths).map(path => <div className="review-path-retained" key={path.edgeIds.join('|')}>
                Survives {pathChain(path)}
                {'shadowPaths' in change && <button type="button" className="review-button" onClick={() => toggle(path.edgeIds[0])}>Include Shadow Edge in Simulation</button>}
              </div>)}
            </details>)}
          </section>)}
          {result.summary.principalsImpacted === 0 && <p>No effective access paths use these edges.</p>}
          {guidance}
        </>}
        {footer}
      </aside>
    </div>
  )
}
