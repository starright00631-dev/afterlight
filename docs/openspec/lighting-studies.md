> Planning and source-research record. Use the delivery README and qa/CURRENT-REPORT.md for implemented behaviour and current verification.

## Purpose

Let a visitor turn testable optical knowledge into a retained comparison and decision for a named task surface, with clear evidence, model boundaries and portable outputs.

## ADDED Requirements

### Requirement: Explicit study ownership and authoring
The system SHALL let users create named personal studies with an explicit project association, a task/question, a 0.3–12 metre surface on each axis, one or two ideal lamps, two to four named horizontal measurement points and one optional vertical opaque screen. These authoring bounds SHALL NOT invalidate commissions or recovered legacy scenes, including existing one-point scenes and scenes with up to three screens. The system SHALL keep studies isolated from unrelated project selection and SHALL identify recovered legacy global work as unassigned until associated explicitly.

#### Scenario: Create a personal study
- **WHEN** a user creates a study for a selected project with valid dimensions and point positions
- **THEN** the saved study retains that association, editable geometry and task without fabricated experiments or observed readings

#### Scenario: Resize would exclude an object
- **WHEN** a proposed surface dimension leaves a lamp, measurement point or screen endpoint outside the surface
- **THEN** the system reports the invalid geometry and does not silently move objects or save the invalid setup

#### Scenario: Switch legacy project
- **WHEN** the user changes the project in a secondary workspace tool
- **THEN** existing study ownership and evidence remain unchanged

#### Scenario: Recover global lab
- **WHEN** a legacy workspace containing a global lab is upgraded
- **THEN** its records appear in a clearly named recovered study without an invented project association

#### Scenario: Preserve a legacy one-point commission
- **WHEN** an otherwise valid legacy distance experiment contains one detector
- **THEN** the upgrade preserves and displays that experiment without forcing a second detector into its evidence

### Requirement: Personal goals with literal scientific quantities
The system SHALL evaluate user-selected illuminance ranges, minimum point uniformity and an optional enabled-intensity ceiling against the exact calculated point readings. It SHALL label ranges as personal study targets, aggregate statistics as applying to selected points, intensity in candela and illuminance in lux. It MUST NOT describe intensity as watts or claim lighting compliance, measured comfort or complete room uniformity.

#### Scenario: Both points satisfy a chosen range
- **WHEN** both selected points calculate to 183.82017707879461 lx and the chosen range is 150–200 lx
- **THEN** both point checks pass and reported point uniformity is 100%, while the source parameters remain separately inspectable

#### Scenario: No enabled illumination
- **WHEN** all lamps are disabled or have zero intensity
- **THEN** readings remain finite and target/uniformity displays do not produce NaN or misleading success

### Requirement: Immutable alternatives and matched comparisons
The system SHALL save named alternative scenes independently of the editable scene and SHALL recompute A/B point readings, per-lamp contributions, target margins and differences. It SHALL identify the measurement geometry and targets used and SHALL compare actual dimensions and stable point identities/coordinates rather than revision identifiers alone. It MUST NOT present alternatives with different surface or point geometry as a matched comparison.

#### Scenario: Edit after saving Option A
- **WHEN** a user saves Option A and then changes the current lamp position
- **THEN** Option A retains its original parameters and readings

#### Scenario: Compare matching alternatives
- **WHEN** Option A and Option B use identical dimensions and labelled point coordinates
- **THEN** the user sees each point's A/B calculated readings, difference, contributions and current target status

#### Scenario: Geometry changed
- **WHEN** one saved alternative uses moved measurement points or different surface dimensions
- **THEN** the system marks the setups as different and requires common geometry before claiming a matched comparison

#### Scenario: Restore common geometry
- **WHEN** a user branches an alternative to restore the original measurement setup
- **THEN** the new branch can be compared once actual geometry matches and the original alternatives remain unchanged

### Requirement: Durable experiment stages
The system SHALL preserve the committed baseline, point, prediction, hypothesis and timestamp before changed readings are revealed. After running, it SHALL persist an unfinished result and editable conclusion until finalization or explicit discard, independently of editable conditions. Resetting, restoring an alternative or switching commissions/studies SHALL preserve a visible return path to that result. A new Run in the same study SHALL require resolving its earlier staged result. Finalization SHALL create one retained experiment. Changed measurement geometry SHALL require a new setup, and multiple changed conditions SHALL not be described as isolating one cause.

#### Scenario: Refresh after Run
- **WHEN** a user runs an experiment, types part of a conclusion and refreshes before finalizing
- **THEN** the result, original prediction/hypothesis and unfinished conclusion resume in the same study

#### Scenario: Restore another arrangement before finalizing
- **WHEN** a user restores an alternative while an unfinished result exists
- **THEN** that result remains recoverable with its original scenes and conclusion and cannot be silently overwritten by a new Run

#### Scenario: Finalize twice
- **WHEN** a previously finalized result is resumed or its finalization action is repeated
- **THEN** the system retains one experiment rather than creating duplicates

#### Scenario: Finalization cannot save
- **WHEN** storing a finalized experiment fails
- **THEN** the system reports failure and retains the staged result rather than clearing it or claiming success

#### Scenario: Move point during commitment
- **WHEN** the user attempts to change measurement geometry while a prediction is committed
- **THEN** the system requires canceling that experiment or explicitly starting a different setup

#### Scenario: Inspect the committed proposal
- **WHEN** a user changes equipment after committing a prediction but before Run
- **THEN** the proposed geometry appears without future calculated field/readings and the separately identified Baseline view keeps frozen equipment, field and readings consistent

### Requirement: A retained decision with evidence links
The system SHALL let a user select a saved arrangement and retain a reason, linked experiment/source evidence and a next measurement or action. A retained decision SHALL freeze the compared alternative identities, target revision/values and calculated comparison/model version used for the choice. These links SHALL resolve within the study/project or be reported as invalid during import. The system SHALL preserve source passage context for reading and optional assistance.

#### Scenario: Choose an arrangement
- **WHEN** a user keeps Option B with a reason based on its named-point comparison
- **THEN** the study stores that arrangement identity, reason and evidence references and can resume them after refresh

#### Scenario: Change targets after choosing
- **WHEN** a user changes personal targets after retaining a decision
- **THEN** the earlier decision/report retains its original targets and comparison, and any evaluation under new targets is identified separately

#### Scenario: Broken imported evidence reference
- **WHEN** an imported decision points to an absent experiment or source
- **THEN** validation reports the broken link and does not silently invent or reassign evidence

### Requirement: Observations stay distinct from calculations
The system SHALL allow optional finite non-negative observed lux records associated with a study, arrangement and point, retaining instrument/method, time and context. It SHALL display observed and calculated values separately and label any arithmetic difference. It MUST NOT fabricate absent observations, overwrite the model output or infer a causal explanation from the difference alone.

#### Scenario: Add a real reading
- **WHEN** the user records an observed 170 lx at a point calculated to 183.82017707879461 lx
- **THEN** both values retain their identities and the observed-minus-calculated difference is approximately −13.82017707879461 lx

#### Scenario: Edit current layout after an observation
- **WHEN** the user changes the editable scene after recording an observation against a saved arrangement
- **THEN** the observation continues to compare with its referenced saved arrangement and its historical calculated value

#### Scenario: No observation entered
- **WHEN** no real observation has been recorded for a point
- **THEN** the observation field remains empty and exports do not fill it with a calculated or example value

### Requirement: Portable evidence outputs
The system SHALL export a printable study with the task, chosen arrangement, configurations/coordinates, point readings, goals, comparison, reason, linked prediction/hypothesis/conclusion, sources, model version, limits and next-check checklist. It SHALL export unit-labelled calculated CSV and validated restorable JSON. CSV string cells SHALL be safe from spreadsheet formula execution while literal prose remains intact in JSON/report and genuine numerical deltas remain numeric. Imported derived readings SHALL be recomputed, and provider credentials/settings MUST NOT enter these outputs.

#### Scenario: Export a finished study
- **WHEN** a user exports a study containing a comparison, finalized experiment and decision
- **THEN** the report, CSV and JSON agree with the retained scene/evidence, preserve units and distinguish observations from calculations

#### Scenario: Formula-like point label
- **WHEN** a point label starts with a spreadsheet formula trigger such as =, +, - or @
- **THEN** CSV treats it as inert text, the report/JSON preserve the literal label and a genuine negative numerical difference remains numeric

#### Scenario: Tampered reading on import
- **WHEN** an imported alternative or experiment contains a derived reading inconsistent with its scene
- **THEN** validation refuses the inconsistent evidence rather than accepting a forged comparison

#### Scenario: Unsupported imported model version
- **WHEN** calculated evidence claims an unsupported model version
- **THEN** import reports that version as unsupported and leaves the existing workspace and original file intact

### Requirement: Preserve legacy work during upgrade
The system SHALL preserve original v2 project/source/idea/action/plan/handoff data, practice attempts, running/paused focus sessions, quiet timers, appearance preferences and pending or retained lab evidence while creating upgraded study state. It SHALL retain an untouched legacy recovery copy and preserve unreadable raw data. New study state SHALL use an explicit version and pass reference validation before becoming the saved workspace.

#### Scenario: Upgrade an existing workspace
- **WHEN** a validated v2 workspace contains notes, plans, quiet handoffs and lab experiments
- **THEN** all original work remains accessible and the global lab is recovered under an explicit study identity

#### Scenario: Upgraded workspace already exists
- **WHEN** v3 workspace data already exists alongside a legacy v2 copy
- **THEN** valid v3 takes precedence and invalid v3 is preserved/reported rather than silently overwritten by v2

#### Scenario: Invalid stored workspace
- **WHEN** stored data cannot be validated
- **THEN** the app identifies the problem and preserves recoverable raw data instead of silently replacing it with a blank workspace
