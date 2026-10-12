> Planning and source-research record. Use the delivery README and qa/CURRENT-REPORT.md for implemented behaviour and current verification.

## Purpose

Provide one coherent Afterlight experience whose visible science, contextual tools and delivery package support a useful lighting study in both day and night appearances.

## ADDED Requirements

### Requirement: One primary product workflow
The system SHALL present Afterlight as one product with Studio, Desk, Library, Week and Quiet as visible workspace destinations. Studies and Field guide SHALL be contextual Studio tools. Desk SHALL retain study evidence and source-linked explanations, Library SHALL retain sources, Week SHALL schedule an explicitly estimated next check with a study link, and Quiet SHALL keep a handoff with a return path. Navigation SHALL retain the active study context and identify the task and selected arrangement.

#### Scenario: Open Afterlight
- **WHEN** a visitor enters the app
- **THEN** they encounter one studio workflow with a clear task and action rather than a choice between two products

#### Scenario: Read a model passage
- **WHEN** a user opens Field guide from an active study
- **THEN** the relevant source and optional assistant retain the study context and return path

### Requirement: Academy commissions use the same studio
The system SHALL offer distance, shadow and balance commissions through a visible chapter selector with plain scientific rules, stated goals and a restrained Academy setting. Recorded progress SHALL distinguish a saved prediction/result/conclusion from numerical target satisfaction. Completing commissions SHALL lead to authoring a personal study in the same app, not a separate application.

#### Scenario: Complete a commission
- **WHEN** a visitor records the prediction, result and explanation and satisfies the commission's numerical goal
- **THEN** the chapter shows completed evidence and offers a personal study using the same controls and model

#### Scenario: Numerically correct without saved explanation
- **WHEN** a visitor reaches a target but has not retained the experiment explanation
- **THEN** the chapter distinguishes target satisfaction from a completed evidence record and does not grant an unsupported mastery score

### Requirement: Model-driven visual light with equivalent controls
The system SHALL show visible calculated light, named measurement points, screen geometry and inspectable paths using the same scene as its textual readings. Decorative illustration MUST NOT introduce unmodelled effects into those readings. All editable geometry and properties SHALL have labelled keyboard-accessible controls, visible focus and readable text results.

#### Scenario: Move a lamp
- **WHEN** a user changes a lamp through dragging or the equivalent numeric control
- **THEN** the geometry, light field, paths and textual readings agree on the same scene

#### Scenario: Use the studio without dragging
- **WHEN** a visitor navigates with a keyboard
- **THEN** they can change every exposed condition, commit/run/finalize an experiment and inspect its result with visible focus

### Requirement: Day and night preserve one study
The system SHALL provide consistent day and night appearances with legible controls/readings and visible light. Appearance changes SHALL preserve study identity, geometry, alternatives, committed/staged experiments and calculated results. The system SHALL respect reduced-motion preferences.

#### Scenario: Change appearance during an experiment
- **WHEN** the user changes from night to day after committing a prediction
- **THEN** the same prediction and baseline remain committed and no numerical or ownership state changes

### Requirement: Responsive stage and action hierarchy
At desktop 1366×900, the system SHALL expose the stage, study brief, meaningful readings and primary action together. At compact 668×518 and mobile 390×844, it SHALL prioritize the stage, selected reading and primary action, provide reachable detailed controls and prevent horizontal overflow or overlapping measurement labels.

#### Scenario: Compact panel
- **WHEN** the studio is shown at 668×518
- **THEN** the visitor can see the stage and current reading and reach the primary action without a long parameter form displacing the experiment

#### Scenario: Mobile studio
- **WHEN** the studio is shown at 390×844
- **THEN** the chapter selector, stage, readings and action form a readable sequence and every detailed control remains reachable

### Requirement: One authoritative submission package
The delivery SHALL contain one Afterlight application root, launch/setup instructions, lockfile, relevant source/tests, credits, current rationale/specifications and a single current QA entry point. Prior applications, builds, source clones, generated concept images and historical forensic payloads SHALL remain outside the submission. Archive members SHALL match the release manifest and pass CRC/hash verification.

#### Scenario: Inspect final archive
- **WHEN** the release archive is opened
- **THEN** it contains one afterlight/ product with one entry point and authoritative version, without an additional Conservatory application or historical release

#### Scenario: Verify packaged source
- **WHEN** the final archive is checked against its manifest
- **THEN** all included file hashes and archive CRC checks pass and the current QA report identifies its tested version

### Requirement: Windows localhost entry
The delivery SHALL provide Start-Afterlight.bat, resolving its own application directory independently of the caller directory. It SHALL use Node 22.13 or later (24 LTS recommended), install locked dependencies when missing, start a loopback-only server and open the page after a bounded health check. It SHALL reuse only a healthy server with matching application, version and root identity. Port collisions SHALL report the problem without stopping an unrelated server.

#### Scenario: Start or reuse the local page
- **WHEN** the user runs the BAT entry
- **THEN** the matching Afterlight page opens after the server is ready, with useful diagnostics if setup fails
