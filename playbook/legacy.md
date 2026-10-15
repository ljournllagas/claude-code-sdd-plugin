# SDD team-lead playbook — Legacy plans

Part of the team-lead playbook (`team-lead.md` holds §0–§2, §11 and §12 and says where every other section lives). Read only for a plan file without `layout: split` (a run begun before Kit 0.3).

## 14. Legacy plans

A **legacy plan** is a plan file without `layout: split` in its frontmatter (a run begun before 0.3, whose marker has no `slice`, so `approved_slices` does not apply to it): the plan file already exists, so no planner dispatch is needed to continue; a 0.2 run that was cut before its plan file was written restarts at §6 step 1 instead. Run the mechanical check, read-only: `node "<kit>/bin/plan.mjs" check "<plan>" --plan` verifies a `**Task count:**` equal to the number of `### T` headings and a `Verify:` line in every task; on a defect re-dispatch the planner (routed, "revise: plan defects"). Then `stage: "plan-review"` (§5), `stage: "plan-approval"` (approval makes the status edit to `approved`; requested changes as in §6 step 7) and §7. Developer prompts carry `Plan:` and `Task:` instead of `Task file:` (§12.2), and the developer card is routed with `--manifest <plan> --task <T-id>` as for a split plan.
