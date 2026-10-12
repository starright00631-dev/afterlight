## Purpose

Give Afterlight a coherent illustrated reading room that remains a real lighting-study interface, with explicit workflow actions and an inspectable visualization of differences between retained arrangements.

## ADDED Requirements

### Requirement: Illustrated atmosphere and calculated scene remain distinct
The system SHALL present a detailed original reading-room setting in day and night appearances, including a wood task surface and restrained brass, ink and parchment controls. Lamps, screens, measurement points, dimensions, paths and calculated light SHALL represent the actual displayed scene. Decorative artwork MUST NOT contribute illumination, cast calculated shadows or replace editable geometry with baked controls or readings. If artwork is unavailable, the scientific scene and controls SHALL remain usable.

#### Scenario: Move an object within the illustrated room
- **WHEN** a user moves a lamp or screen using the stage or its equivalent numeric controls
- **THEN** its visible location, dimensions, paths and numeric readings agree with the same scene while room decoration remains outside the calculation

#### Scenario: Artwork has not loaded
- **WHEN** a room image fails to load
- **THEN** the user can still inspect and change the model, run an experiment and read its calculated results

### Requirement: Workflow labels trigger actual work
The system SHALL provide reachable Arrange, Predict, Compare and Choose actions. Arrange SHALL expose scene editing, Predict SHALL expose the current study's commit/run/conclusion workflow, Compare SHALL expose two saved alternatives and their comparison, and Choose SHALL open a retained decision using the selected matched pair. Unavailable actions SHALL explain their concrete prerequisite. These actions MUST preserve committed or staged work and SHALL reflect the current study without creating records by navigation alone.

#### Scenario: Begin a study with no saved alternatives
- **WHEN** a visitor opens Compare or Choose before saving two distinct arrangements
- **THEN** the interface explains how to save the required alternatives and provides a reachable route to arranging and saving work without inventing comparison or decision records

#### Scenario: Resume an unfinished experiment
- **WHEN** a user returns to Predict after navigation or refresh with a committed prediction or staged conclusion
- **THEN** the current baseline or unfinished result is shown and the next valid action resumes that evidence rather than replacing it

### Requirement: Difference field uses a matched immutable pair
The system SHALL offer a calculated difference-field view for two distinct saved arrangements only when their actual surface dimensions, measurement-point identities and point coordinates match. At each displayed sample location the field SHALL show illuminance of Option B minus illuminance of Option A in lux using those immutable scenes and the existing optical model. It SHALL identify both alternatives, distinguish this comparison from the working layout, and retain an accessible per-point numerical comparison. Mismatched or absent pairs SHALL yield a clear explanation and no numerical difference field.

#### Scenario: Inspect positive and negative differences
- **WHEN** a matched pair produces higher light in one location and lower light in another
- **THEN** the field shows the corresponding positive and negative B minus A values and the per-point table agrees with calculations for the same pair

#### Scenario: Edit the working layout after saving the pair
- **WHEN** the user changes a lamp in the working layout while viewing a saved A/B difference field
- **THEN** the saved comparison remains unchanged and the interface identifies that the field belongs to the retained pair

#### Scenario: Reject a different measurement setup
- **WHEN** the selected pair has different surface dimensions, point identities or coordinates
- **THEN** the difference view explains the mismatch and does not portray a matched contrast

### Requirement: Difference colours have an honest scale
The difference view SHALL include a signed lux legend and textual meanings for brighter, dimmer and unchanged relative to Option A. Its colour scale SHALL be symmetric around zero and SHALL report its current displayed range. Identical scenes or an all-zero result SHALL produce a finite neutral field and an explicit unchanged status. Differences SHALL remain calculated outputs and MUST NOT be described as observed readings, measurement uncertainty or a causal proof.

#### Scenario: Swap the alternatives
- **WHEN** a user exchanges Option A and Option B for the same matched scenes
- **THEN** every sampled and displayed point difference reverses sign with the same absolute scale

#### Scenario: Compare identical scenes under different saved identities
- **WHEN** both arrangements contain identical scenes
- **THEN** all differences are zero, the field is neutral and the legend contains no undefined or infinite value

### Requirement: Readable responsive actions and readings
At 1366×900 the studio SHALL present the room stage, compact brief, live readings and primary workflow controls together. At 668×518 and 390×844 it SHALL prioritize the stage, current reading and next action while leaving every detailed control reachable. Text SHALL remain readable against artwork; body and control text SHALL meet 4.5:1 contrast and large text and essential non-text controls SHALL meet 3:1. The interface SHALL support keyboard operation, visible focus and reduced motion without horizontal overflow or overlapping readings.

#### Scenario: Use the studio with a keyboard on a small screen
- **WHEN** a visitor uses only keyboard controls at 390×844
- **THEN** they can arrange, save, predict, run, finalize, compare and choose through labelled controls with visible focus and readable results

#### Scenario: Compare in either appearance
- **WHEN** the same saved pair is viewed in day and night or with reduced motion enabled
- **THEN** the calculated values and signed legend retain their meaning and numerical results remain available without animation

### Requirement: Existing evidence and fresh state remain truthful
The redesign SHALL preserve study ownership, alternatives, decisions, sources, observations, pending/staged experiments and existing portable exports. Appearance changes SHALL preserve their identities and numerical values. A fresh workspace SHALL have no fabricated saved alternatives, experiments, decisions, real observations or mastery history; any authored starting scene SHALL be visibly identified as an example calculation. The packaged release SHALL include the original illustration assets and current rationale/QA while preserving the previous release as a rollback artifact outside the new package.

#### Scenario: Fresh workspace
- **WHEN** a user opens Afterlight with no stored work
- **THEN** authored example geometry can be explored, but the record sections show their real empty state and any displayed readings are labelled calculated

#### Scenario: Reopen existing work after the visual upgrade
- **WHEN** a saved 3.0 workspace is loaded and exported through the redesigned studio
- **THEN** its retained evidence and numerical values are preserved, including unfinished work and separately labelled real observations
