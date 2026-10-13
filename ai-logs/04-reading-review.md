# 04: Understandable Imports and Source-Linked Review

**Reconstructed example, not an original prompt or executed conversation record.** Derived from the final implementation; no simulated reply or execution date is supplied.

## Example prompt

Make reading intake and review understandable. Selecting a file should not leave the user unsure what has happened.

Preview PDF, text or Markdown content without saving it. Save only after an explicit Add reading action. Cancellation, late responses, duplicate additions or failed persistence must not alter existing records. Extract PDF text within limits of 20 MiB, 80 pages, 120,000 characters and 2,000 passages. For scans, protected files or insufficient extracted text, explain the limitation and offer Paste text. Do not imply OCR or an original-page viewer.

Keep original paragraph anchors. Let users create ideas, questions, answer criteria and concrete output tasks from a passage. During review, hide the source while the user answers, then reveal the reference for self-assessment. Bound the queue and preserve drafts and position. Each assessment must freeze the question, criteria and source at that time; later edits must not rewrite history.

Use transparent 1-, 3- and 7-day revisit rules. Skip creates no assessment or new due date. Undo must not overwrite later unrelated work. Distinguish full-workspace JSON, accepted-calendar ICS and lighting-data CSV; make clear that CSV cannot restore a workspace.

## Acceptance criteria

- File selection and saving are different states. The confirmation control is reachable on small screens.
- Navigation and reload preserve the review draft. References stay hidden until explicit reveal.
- Skip, inability to recall, assessment and Undo have separately inspectable effects.
- Source references remain valid and can return to the original passage. Do not generate learning scores or mastery claims.
