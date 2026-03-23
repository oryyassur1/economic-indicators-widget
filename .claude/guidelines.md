# Project Guidelines

## Instruction Handling
- Before starting implementation, re-read the user's message and create a checklist of EVERY distinct request/sub-item.
- After implementation, go through the checklist and verify each item was addressed.
- Pay special attention to phrases like "I need an interface", "I want to be able to", "allow me to" — these indicate a UI/UX requirement, not just a data structure.
- When the user asks for "an interface to define X", they mean a visual UI (form, modal, panel), NOT a JSON file to edit by hand.
- If a request is ambiguous, ask — don't silently pick the simpler interpretation.

## Atomic Subtask Breakdown (Generic — applies to all projects)
- Every time you receive an instruction, break it down into atomic subtasks before starting work.
- Each atomic subtask should be a single, testable unit of work (e.g., "hover on flag shows popup text", "hover on flag draws vertical line", "click on flag opens URL").
- Write out the subtask list explicitly (in a todo list or inline) so nothing is overlooked.
- After implementing each subtask, test/verify it individually — do not batch-verify at the end.
- If a subtask cannot be tested (e.g., no preview available), note it as unverified and flag it to the user.
- Only mark the parent task as complete when ALL atomic subtasks pass verification.
