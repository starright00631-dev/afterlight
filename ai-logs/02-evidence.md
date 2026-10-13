# 02: Experiments and Evidence That Remain Distinct

**Reconstructed example, not an original prompt or executed conversation record.** Derived from the final implementation; no simulated reply or execution date is supplied.

## Example prompt

Organize the lighting table around a study process that can explain a decision, rather than only display a passing result.

Let the user choose a measurement point, commit a predicted change and explanation, then adjust the arrangement and run the experiment. Freeze the original conditions when the prediction is committed. Before Run, cover proposed results and prevent field colors, paths or hover readings from revealing the answer. Save the result and conclusion separately; a correct prediction does not establish understanding.

Saved arrangements must retain their geometry and calculated readings. Later edits must not rewrite history. Allow comparisons only when table dimensions and corresponding measurement points match. Define differences explicitly as B minus A and use a symmetric legend. Preserve the decision's reason, targets at that time and next check.

Keep user-entered meter observations separate from model readings, including instrument and environmental context. Do not calibrate automatically or invent measurements. Recompute imported results and validate references before replacing a workspace; failed validation must preserve existing data.

## Acceptance criteria

- Commit, Run and conclusion are distinct states.
- Editing the working arrangement does not rewrite saved predictions, arrangements or decisions.
- Mismatched measurement setups are explicitly rejected. Difference signs and legends agree.
- Exports match retained records; an invalid import preserves the current workspace.
- Provide connections to Use in my work and Plan the check, while navigation alone creates no measurement or completed task.
