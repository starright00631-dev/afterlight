## Purpose

Provide an inspectable licensed source repository, restorable local release and independently usable online application while preserving the privacy and scientific boundaries of Afterlight.

## ADDED Requirements

### Requirement: Complete licensed source and release
The project SHALL publish its maintained runnable source, tests, original runtime assets, lockfile and installation documentation with a noncommercial software license and applicable third-party notices. It SHALL exclude credentials, installed dependencies, runtime logs, private inputs and unrelated earlier prototypes.

#### Scenario: Visitor obtains the local application
- **WHEN** a visitor downloads the versioned application release
- **THEN** the archive contains one Afterlight root, a launcher, current source and license notices, with hashes and CRC verified against its manifest
- **AND** installing the locked dependencies and launching from a fresh path opens a matching version of the application

### Requirement: Browser deployment preserves the interactive core
The hosted application SHALL support editable lighting studies, predictions, saved comparisons and decisions, source-linked work, planning, handoff and export/import using browser-local records. It SHALL retain the same authored scientific model as the local application and SHALL not populate users' records with fabricated results.

#### Scenario: First hosted visit
- **WHEN** a visitor opens the deployed project URL
- **THEN** its original day/night artwork and live model load under the project path
- **AND** the visitor can change conditions and retain/export a study without provider access
- **AND** unsupported comparison operations explain their prerequisites until suitable arrangements exist

### Requirement: Explicit hosted capabilities
The browser deployment SHALL handle supported selectable-text PDFs in the visitor's browser with documented byte, page and text limits. It SHALL not expose provider credentials or attempt to use unavailable localhost provider routes. The local application SHALL preserve its provider connections and loopback request protections.

#### Scenario: Hosted source reading and assistance
- **WHEN** a visitor imports a supported PDF into the hosted application
- **THEN** the extracted source becomes usable without sending that PDF to an Afterlight backend
- **AND** assistant connection/action controls are unavailable with an explanation of local-app provider support

### Requirement: Inspectable public presentation and verification
The public README SHALL include actual visual examples, installation, deployment capability distinctions, data backup behavior, model limits, license and release links. Publication SHALL be verified through repository contents, a successful deployment and a live browser workflow.

#### Scenario: Publication completes
- **WHEN** the project reports its repository, release and demo as published
- **THEN** those resources exist at the reported URLs and the live application has been exercised
- **AND** the report distinguishes verified core workflows from pending or unavailable integrations
