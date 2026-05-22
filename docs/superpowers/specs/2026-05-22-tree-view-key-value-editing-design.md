# Tree View Key And Value Editing Design

## Goal

Add direct editing to Tree View for object property keys and leaf values while keeping the raw JSON editor as the source of truth.

## Scope

Tree View will support:

- Renaming keys for object properties.
- Editing leaf values for strings, numbers, booleans, and nulls.
- Editing primitive values inside arrays and nested objects.
- Writing changes back through Monaco with minimal source replacement so undo, redo, formatting, comments, and unrelated source text stay intact.

Tree View will not support:

- Renaming array indexes.
- Editing object or array containers as a single value.
- Reordering, adding, or deleting Tree View nodes.
- Changing value types implicitly from one primitive type to another.

## Interaction

Editable Tree View labels expose a compact edit affordance on hover.

- Object-property key text can enter key editing mode.
- Leaf value text can enter value editing mode.
- Editing uses an inline single-line input and focuses it immediately.
- Blur commits valid edits.
- Enter commits valid edits.
- Invalid edits stay in editing mode and show an inline error state.

Key editing rejects empty names and sibling duplicates. Keys are written back as JSON strings with escaping handled by the edit service.

Value editing follows the Grid value rules already used in the app:

- Strings keep string type and are written with proper escaping.
- Numbers only accept valid JSON numeric text.
- Booleans only accept `true` or `false`.
- Null only accepts `null`.

## Architecture

`JsonTreeView` owns Tree-specific UI state for the active key or value editor. The component continues to parse `content` with `parseJsonDocument()` and uses pointer metadata to build node ranges for source writes.

Value writes reuse the existing Grid leaf-value conversion and range replacement behavior where possible. Key renames use a small Tree-focused edit service that:

- Determines whether a node key may be renamed.
- Validates a proposed key against its sibling object keys.
- Produces the JSON source replacement for the property key range.

`MonacoEditor.replaceRangeByOffsets()` remains the writeback boundary. Source edits flow through Monaco's existing change handling so tabs, stats, Tree View rebuilding, Grid View, and undo history continue to follow the current editor pipeline.

## Data Flow

1. Tree View parses the latest editor content and builds nodes with JSON pointer paths and source ranges.
2. The user opens an inline key or value editor from a Tree node.
3. The edit helper validates the input and creates a source replacement payload.
4. Tree View calls Monaco range replacement for the specific key or value source segment.
5. Existing content change propagation updates the document state and rebuilds Tree View from the edited source.

Tree expansion should remain useful across the edit by relying on the existing expansion state where the edited path still exists. A key rename may change the edited node path after parsing; the renamed branch may fall back to normal Tree rebuilding behavior.

## Error Handling

- Parse errors continue to use the current Tree View parse error display.
- Missing source ranges do not write text and surface an inline editing error.
- Empty or duplicate object keys do not write text.
- Invalid primitive value input does not write text.
- Editor changes made elsewhere while an edit is open are handled by Tree View rebuilds from the latest `content`.

## Testing

Add focused service tests for key rename validation and replacement generation:

- Object property keys are renameable.
- Array index labels are not renameable.
- Empty names and sibling duplicates are rejected.
- Escaped key text writes valid JSON source.
- Pointer-based key ranges replace only the target key and preserve surrounding text.

Cover Tree View source behavior with component-oriented assertions already used in the repo where practical:

- Key and value edit affordances are limited to supported nodes.
- Value editing reuses primitive type validation.
- Tree writes through Monaco range replacement.

Run the existing test and check commands to guard Grid, Tree queries, panel switching, and editor behavior.
