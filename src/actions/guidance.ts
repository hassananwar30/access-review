import { lookupOwn, resolveAppMembership, type ActionHandler } from 'deepspace/worker'
import type { Env } from '../../worker'

const domains = ['csrc.nist.gov', 'learn.microsoft.com']
const topics = {
  shadowPath: 'least privilege remove inherited group role assignments review redundant access',
  serviceAccount: 'service principal workload identity least privilege permissions review before revocation',
  downgrade: 'role based access control replace administrator role with read only privilege',
  revocation: 'access review revoke expired user group membership offboarding least privilege',
}

export const findGuidance: ActionHandler<Env> = async ({ env, userId, params, tools }) => {
  const membership = await resolveAppMembership(env, userId)
  if (!membership) return { success: false, status: 503, error: 'Could not verify workspace membership.' }
  if (!membership.member) return { success: false, status: 403, error: 'Workspace membership is required.' }
  const query = typeof params.topic === 'string' ? lookupOwn(topics, params.topic) : undefined
  if (!query) return { success: false, status: 400, error: 'Choose a supported remediation topic.' }
  const result = await tools.integration<{ results: { title: string; url: string }[] }>('exa/search', {
    query, includeDomains: domains, numResults: 4,
  })
  if (!result.success) return { success: false, status: 502, error: 'Guidance search is unavailable.' }

  const links = new Map<string, { title: string; url: string }>()
  for (const item of result.data.results ?? []) {
    if (typeof item.title !== 'string' || typeof item.url !== 'string') continue
    const url = URL.parse(item.url)
    if (!url || url.protocol !== 'https:' || url.port || url.username || url.password || !domains.includes(url.hostname)) continue
    if (!links.has(url.href)) links.set(url.href, { title: item.title, url: url.href })
    if (links.size === 2) break
  }
  return { success: true, data: { links: [...links.values()] } }
}
