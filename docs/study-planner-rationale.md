# Study planner rationale

Implemented in **Afterlight 3.4.0**, 13 October 2026. The shared planner and source-review workflow extend the existing application. Release checks are recorded in [the verification report](../qa/CURRENT-REPORT.md).

Afterlight connects retained sources, questions and concrete outputs to the time available for working on them. The refinement addresses overlapping project plans, disconnected review attempts and the absence of dated work outcomes. It extends the existing Desk, Library, Week and Quiet workflow while preserving Studio's optical records and model boundaries.

## Inspected references and adaptation

| Reference | Relevant observation | Afterlight decision |
| --- | --- | --- |
| [Super Productivity v19.2.0](https://github.com/super-productivity/super-productivity/tree/v19.2.0) | Today, Inbox and Planner give unscheduled work and dated work distinct destinations. Its [day agenda](https://github.com/super-productivity/super-productivity/blob/v19.2.0/src/app/features/planner/planner-day/planner-day.component.html#L11) compares planned duration with availability. The [task model](https://github.com/super-productivity/super-productivity/blob/v19.2.0/src/app/features/tasks/task.model.ts#L110) separates scheduled day/time from deadline day/time, despite the scheduled fields' `due` names. | Use one capacity across projects, keep an inbox beside the agenda, expose work that cannot fit, and retain deadlines when reservations move. Selected for its fit with Afterlight's planning scope. |
| [Anki studying manual](https://docs.ankiweb.net/manual/studying#questions) | Retrieval precedes answer revelation; the learner then compares and assesses the answer. | Preserve Afterlight's existing hidden-source recall, then add bounded queues, retained drafts and explicit failure. The retrieval mechanic already existed; this pass improves its continuity and evidence. |
| [SiYuan flashcard reveal logic](https://github.com/siyuan-note/siyuan/blob/fb3355f07d22bff36f1d785999fd5ded6a90d468/app/src/card/flashcardMode.ts#L55) and [block-linked review model](https://github.com/siyuan-note/siyuan/blob/fb3355f07d22bff36f1d785999fd5ded6a90d468/kernel/model/flashcard.go#L635) | Questions remain connected to document blocks and have an explicit reveal state. | Retain the source anchor during navigation. Afterlight additionally saves immutable question, criteria and passage snapshots when an assessment is made; this snapshot format is our own design. |

These are workflow references. The new planner, review logic and interface are original implementations. No third-party application code or assets, including AGPL application code or assets, were copied into Afterlight.

## Planning contract

Week requires explicit adoption of one project's window as the shared calendar. Earlier project plans remain retained; their capacities are not added together. The calendar uses a seven-day window in **Asia/Shanghai**, date-specific availability and manually entered fixed commitments. Arbitrary time zones, calendar-account synchronization and notifications are outside this refinement.

Three records have distinct meanings:

- **Proposal:** a preview calculated from estimates, prerequisites, deadlines, commitments, rest and useful block lengths. Nothing is reserved until acceptance.
- **Accepted allocation:** a dated reservation with a stable identity. Manual placement and movement validate its constraints. Valid pins survive replanning; infeasible work and conflicts remain visible. Returning work to the inbox retains the task. Unscheduling has a guarded one-step Undo, and blocks referenced by work history retain their identity.
- **Actual work session:** a retained elapsed duration and a user-reported outcome. A reservation is not evidence that work occurred or that an action was finished.

The original estimate, explicitly revised remaining effort and elapsed focus time remain separate. Time spent never subtracts automatically from an estimate. Desk offers today's allocations and work whose prerequisites have actually been completed; a proposed predecessor does not make dependent work ready.

## Review and work outcomes

A review has a finite due-question queue and a chosen time budget. Its current answer, reveal state and progress survive navigation and reload. User-authored answer criteria remain separate from the original source paragraph. Assessment retains the actual answer, rating, question, criteria and source context; later note edits do not rewrite that history. Earlier attempts without snapshots are labelled accordingly.

Skip advances without creating an attempt or changing a revisit date. “Couldn't recall” allows an empty answer and uses Again when assessed. Undo restores the latest assessed item and removes that assessment without rewriting unrelated history. Reading the source preserves the queue position.

A review action placed in Week retains its selected question IDs and budget. Opening it starts the relevant still-due queue and exposes its focus timer with pause/resume controls. Completing or ending the question queue does not automatically finish the action. Quiet closes the work session through an explicit **finished**, **needs another session** or **blocked** outcome, retaining output, reported remaining effort and a concrete next step. Elapsed time measures neither attention nor learning.

FSRS integration is deferred. Again, Uncertain and Understood retain the existing fixed **1/3/7-day** revisit rules. These dates are transparent scheduling rules, not calibrated memory predictions, mastery scores or automatic grades.

## Migration and artifact evidence

Workspace format v4 validates the new references and records before saving. Existing v3/v2 keys, source links, drafts, review history and optical studies remain preserved. Earlier elapsed-time aggregates are retained without inventing dated sessions or historical question snapshots. Application version 3.4.0 does not change the retained optical formats.

REA was used for the shipped artifact boundary. Cached **rea-agents 6.4.0** ran `inspect-artifact` on `D:\work\afterlight-release.zip`. The retained [complete JSON evidence](../qa/workbench-rea-artifact.json) identifies:

- SHA-256: `3d8040d524c9d4a0f9c3273b81fb20e811a46d9e4593096165103d2bf68badef`
- Evidence: `ev_c7a86bd0b9f5df5207eaba3261d68e846bbf4a86ded68a3cba112d2d8b68f340`
- ZIP inventory: **98 graph nodes, including the archive root; 97 members**.

This is a bounded central-directory inventory of the preserved **3.3.0** archive. REA did not execute the archive, prove source-level features or validate the new interface. Source inspection, automated regression checks and actual browser acceptance provide those separate forms of evidence. Version 3.4.0 has its own release archive, manifest and receipt.
