## Context

See publication-proposal.md. The current 3.1 application assumes a loopback Node service for provider status, assistance and PDF extraction. Most study, source, scheduling and export behavior already executes in the browser. The authenticated CLI and the requested Edge profile both identify the same public account.

## Goals / Non-Goals

Goals: publish one maintained source tree and versioned local application; provide a usable browser deployment; preserve private browser records and distinguish hosted capabilities from local provider capabilities.

Non-goals: expose the existing Node provider service publicly, provision a paid service, embed credentials, claim untested inference, or include historical prototypes and raw forensic records in the public tree.

## Decisions

1. Use GitHub Pages for a static browser build. Unlike a public copy of the localhost server, it needs no provider secrets or broader network binding. The full Node application remains available through source and the release ZIP.
2. Use an explicit build-time capability module, not hostname guesses. Central client adapters route PDFs to browser PDF.js in the hosted build and to the existing service locally. Hosted assistance/connect controls are unavailable with clear explanatory text rather than failing HTTP calls.
3. Bundle the locked PDF.js browser worker and resources with upstream notices. This avoids a CDN dependency for visitors' PDF intake, while keeping the current byte/page/text limits and error/cancellation behavior.
4. Apply the official PolyForm Noncommercial 1.0.0 text to original project work. Third-party files retain their licenses. Commit with the public GitHub noreply identity, and exclude runtime records, environment files, node_modules and stale QA.
5. Publish current native screenshots and synthetic QA exports only. Sanitize local machine paths in selected public rationale. Preserve older ZIPs privately as rollback artifacts outside the repository.
6. Pin GitHub Actions to verified upstream commits. Verify on Windows and Ubuntu with Node 24; deploy only the dedicated browser output using minimal Pages permissions and the github-pages environment.

## Risks / Trade-offs

- Hosted AI is unavailable → provide the complete deterministic workflow and direct visitors to the local application for provider connections.
- Browser storage is origin-specific → document full-workspace exports and restore behavior; never seed visitor storage with QA records.
- PDF compatibility differs by runtime → retain the limits, test browser extraction and reject encrypted/scanned documents clearly.
- The licensed source is noncommercial rather than unrestricted open source → identify the license plainly and preserve upstream dependency exceptions.
- Deployment can fail after source publication → inspect Actions, repair the specific failure, verify the live URL before reporting success, and retain the verified prior ZIP.

## Migration Plan

Preserve 3.1 archive/receipt, add capability adapters and build, run regression/export/build checks, preview under a project URL prefix, review the public file list, commit/push, enable Pages, verify Actions and live Edge workflows, publish the checked release ZIP and receipt, then record the public URLs and exact revision. A code regression can be reverted through Git; older local releases remain intact.
