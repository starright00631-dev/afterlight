# 03: A Shared Calendar and Work That Fits

**Reconstructed example, not an original prompt or executed conversation record.** Derived from the final implementation; no simulated reply or execution date is supplied.

## Example prompt

Improve the usefulness of the existing Week page. Keep its visual direction rather than replace it with a different calendar product.

All projects must share one availability budget. Adopt an existing window explicitly and retain earlier project plans. Support fixed commitments, date exceptions, rest, useful minimum blocks, estimates, deadlines and prerequisites. Commitments, accepted reservations and rest consume the same capacity. Long actions can span days; unplaced work must retain an explanation.

Separate proposals, accepted reservations and actual work records. Generating a proposal neither reserves time nor completes a task. Revalidate constraints before acceptance. Preserve valid pins and stable reservation identities. Starting work requires prerequisites to be actually complete.

Use one clock scale across all seven days. Selecting a day or gap should expose reservations, source context, unfinished prerequisites and validated placement choices. Deduct effort already reserved on other dates before offering more work. Inspection must not start a timer. Move, unschedule and Undo must preserve historical references; an invalid save must retain entered values.

## Acceptance criteria

- Different projects cannot spend the same time capacity twice.
- Proposed sessions are clearly unaccepted. Accepted and Proposed views use the same clock extent.
- Impossible deadlines, cyclic dependencies and unplaced work have explicit explanations.
- Starting a split reservation uses that session's minutes, not the whole task estimate.
- Calendar export includes accepted reservations only, with stable identifiers and explicit UTC times corresponding to Asia/Shanghai civil time. It does not imply calendar-account synchronization.
