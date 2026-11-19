import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, ShieldCheck } from 'lucide-react'
import { ReviewSimulator } from '../components/ReviewSimulator'
import { Seo } from '../components/Seo'
import { seedEdges, seedNodes } from '../lib/seedOrg'
import { seo } from '../seo'

export default function Landing() {
  const [selected, setSelected] = useState<string[]>([])
  const workspace = { pathname: '/home', search: new URLSearchParams(selected.map(id => ['edge', id])).toString() }
  return (
    <>
      <Seo {...seo} path="/" />
      <main data-testid="static-landing" className="review-page min-h-screen">
        <div className="review-shell">
          <header className="review-mast">
            <span className="review-brand"><ShieldCheck size={22} /> Access Review</span>
            <Link to={workspace} className="review-button review-primary">Sign in to Propose &amp; Collaborate <ArrowRight size={15} /></Link>
          </header>
          <div className="review-hero">
            <h1>Preview a permission change</h1>
            <p>Explore Kestrel Cloud. Select a relationship to see who would lose access and which alternate paths would keep it in place.</p>
          </div>
          <ReviewSimulator nodes={seedNodes} edges={seedEdges} selected={selected} onSelection={setSelected} />
        </div>
      </main>
    </>
  )
}