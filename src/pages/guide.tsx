import { ArrowRight, GitBranch, ScanSearch, ShieldCheck, Workflow } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Seo } from '../components/Seo'
import { seo } from '../seo'
import '../components/review.css'
import '../components/review-guide.css'

function GuideLinks() {
  return (
    <div className="guide-actions">
      <Link to="/" className="review-button review-primary">Launch Interactive Demo <ArrowRight size={16} aria-hidden="true" /></Link>
      <Link to="/home" className="review-button">Open Full Workspace</Link>
    </div>
  )
}

export default function Guide() {
  return (
    <>
      <Seo {...seo} path="/guide" title="How Access Review works" description="Read the permission graph, explore three demo scenarios, and follow a revocation from simulation to audit." />
      <main className="review-page guide-page">
        <div className="review-shell guide-shell">
          <header className="review-hero guide-hero">
            <Link to="/" className="review-brand"><ShieldCheck size={22} aria-hidden="true" /> Access Review</Link>
            <h1>How Access Review works</h1>
            <p>Follow a permission from the person or bot that uses it to the resource it unlocks. Then see what changes when you remove a relationship.</p>
            <GuideLinks />
          </header>

          <div className="guide-grid">
            <section className="review-panel guide-section" aria-labelledby="permission-flow">
              <h2 id="permission-flow"><GitBranch aria-hidden="true" /> Entity &amp; Permission Flow</h2>
              <ol className="guide-flow" aria-label="Permission graph columns">
                <li>Principals</li><li>Groups</li><li>Roles</li><li>Resources</li>
              </ol>
              <p>Principals are people and service accounts. Groups collect identities, roles bundle privileges, and resources are the systems or data those privileges cover.</p>
              <dl>
                <dt><code>MEMBER_OF</code></dt><dd>A person, bot, or group belongs to a group.</dd>
                <dt><code>ASSUMES</code></dt><dd>An identity or group takes on a role.</dd>
                <dt><code>GRANTS_READ</code> <code>GRANTS_WRITE</code> <code>GRANTS_ADMIN</code></dt>
                <dd>A grant gives read, write, or admin access to a resource. The strongest surviving grant determines effective access.</dd>
              </dl>
            </section>

            <section className="review-panel guide-section" aria-labelledby="blast-radius">
              <h2 id="blast-radius"><ScanSearch aria-hidden="true" /> Selected for Removal &amp; Blast Radius</h2>
              <p>Click a relationship to simulate removing it. A dashed red edge marks your selection. The live graph changes only after an admin approves a proposal.</p>
              <dl>
                <dt>Loses Access</dt><dd>Every path to the resource is broken.</dd>
                <dt>Shadow Path / Retained</dt><dd>An alternate path still grants the same level of access.</dd>
                <dt>Downgraded</dt><dd>Access remains at a lower level, such as ADMIN → READ.</dd>
                <dt>Service Account / Automation Warning</dt><dd>A bot lost access or dropped to a lower level. Either can interrupt automation.</dd>
              </dl>
            </section>

            <section className="review-panel guide-section" aria-labelledby="preset-scenarios">
              <h2 id="preset-scenarios"><Workflow aria-hidden="true" /> The 3 Preset Scenarios</h2>
              <dl>
                <dt>Shadow Path</dt><dd>Dana Patel keeps database admin access through Ops-OnCall → Legacy-VPN-Admins → Prod-DB-Admin after the Contractors grant is removed.</dd>
                <dt>CI Bot Outage</dt><dd>Removing the CI release grant cuts <code>ci-deploy-bot</code> off from <code>k8s-prod-cluster</code>.</dd>
                <dt>Downgrade</dt><dd>Alex Rivera drops from ADMIN to READ on <code>prod-customer-pii</code> through a surviving analytics role.</dd>
              </dl>
            </section>

            <section className="review-panel guide-section" aria-labelledby="governance">
              <h2 id="governance"><ShieldCheck aria-hidden="true" /> Governance Workflow</h2>
              <ol className="guide-steps">
                <li><strong>Simulate.</strong> Select edges and inspect the paths that break or survive.</li>
                <li><strong>Propose Revocation.</strong> Sign in to submit the selected edges and your rationale.</li>
                <li><strong>Admin / IAM Approver.</strong> The server enforces role-based access control and recomputes impact against the live graph before applying an approval.</li>
                <li><strong>Audit Log.</strong> The immutable entry records who acted, what changed, and the recomputed impact.</li>
              </ol>
              <p>The <strong>Least-Privilege Advisor</strong> can explain alternate paths and suggest targeted removals. <strong>Find official guidance</strong> uses Exa to surface up to two NIST or Microsoft Learn links.</p>
            </section>
          </div>
          <footer className="guide-footer"><GuideLinks /></footer>
        </div>
      </main>
    </>
  )
}
