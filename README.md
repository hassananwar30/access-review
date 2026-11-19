# Access Review

[Try Access Review](https://access-review.app.space/)

Preview the impact of removing a permission before applying it. Access Review
traces effective access through the fictional Kestrel Cloud organization and
shows which people and service accounts would lose, retain, or downgrade access.

## 60-second walkthrough

1. Open the public simulator and select **Shadow Path**. Removing the Contractors
   grant leaves Dana Patel with database admin access through Ops-OnCall,
   Legacy-VPN-Admins, and Prod-DB-Admin. Expand her result to see both paths.
2. Select **CI Bot Outage** to see the automation warning, then **Downgrade** to
   see Alex Rivera retain read access to customer PII after losing admin access.
3. Select **Sign in to Propose & Collaborate** to carry the chosen edges into the
   studio. A member or admin can add a rationale and submit the review. An admin
   can approve or reject it with a decision note. The proposal, permission graph,
   and audit log update in both reviewers' browsers.

On the first signed-in visit, an admin can use **Reset Demo Org** to initialize
the shared workspace.

## DeepSpace features

- **Authentication and collection RBAC** identify the reviewer and gate writes.
  Approved revocations and audit entries are written by the server.
- **RecordRoom** synchronizes the graph, proposal queue, comments, and audit log.
  The approval action recomputes impact from the live graph before applying it.
- **PresenceRoom** shows who is online and which relationships they are simulating.
- **AI chat and registerAgent** expose the same revocation simulation,
  shadow-path lookup, minimal-cut search, and pending-proposal creation tools.
- **Exa Search** is called from the authenticated guidance action with developer
  billing. It returns up to two HTTPS links from NIST or Microsoft Learn.

## Scope

The demo uses synthetic IAM data. Approvals modify the shared demo graph.
The public simulator runs entirely in the browser. The deterministic TypeScript
engine is shared with the Worker and searches minimum cuts up to three edges.
The release focuses on review and approval. Snapshot import and export are deferred.

## Local checks

```sh
npm ci
npm run validate
npx deepspace test run all
```

The signed-in review test uses two usable DeepSpace test accounts. Check the
local pool with `npx deepspace test accounts list --usable`. The test server
assigns its first fixture account as the local owner, isolates records in memory,
and restores the demo graph in a `finally` block.
