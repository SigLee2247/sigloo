# Sigloo 0.1.0 local beta

## Scope

`0.1.0` names the completed local MVP for Browser and Process Spaces. It is a versioned local beta, not a public
package release.

## Included

- isolated Browser Space with bounded actions and optional Viewer takeover
- managed Auth Profiles with explicit login capture
- named Process Spaces with evidence and deterministic cleanup
- experimental Desktop Space for Electron-style launchers with isolated `userData`
- crash-safe Chrome supervision and temporary-profile recovery
- local installer and companion `$sigloo` Skill

## Verification

- 19 automated tests passed
- 100 independent Browser runs passed
- concurrent Spaces, forced termination recovery and install lifecycle passed
- SigTerm existing `npm run typecheck` passed inside a Process Space

## Deferred

Desktop/Electron drivers, OS-level Process sandboxing, remote CI distribution and public package publication remain
outside this beta.
