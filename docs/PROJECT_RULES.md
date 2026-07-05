# Project Rules

## UI Styling

- Use Tailwind utility classes for React UI styling by default.
- Keep component layout, spacing, typography, color, borders, shadows, and interaction states in JSX class names.
- Keep `src/styles.css` small. It should contain Tailwind imports, global transparent-window baselines, shared design tokens if needed, and keyframes that are awkward to express inline.
- Do not add new component-scoped semantic CSS classes such as `.island-card`, `.icon-button`, or `.panel-body` for ordinary UI styling.
- Prefer small class string constants in the component when the same Tailwind utility group is reused several times.
- Add custom CSS only when Tailwind cannot express the behavior clearly or when the rule must be global.

## Floating Island

- Preserve the 600 x 54 collapsed window shape unless the product spec changes.
- Keep drag behavior explicit through Tauri `startDragging()` for known draggable surfaces.
- Keep business buttons separate from draggable surfaces so clicks and drags do not compete.
- Do not allow text selection in the top floating bar.

## Platform Scope

- Meetly is macOS-only for the current product scope.
- Do not add Windows/Linux compatibility modules, dependencies, fallback code, or documentation promises unless the product scope changes explicitly.
- Native audio capture should use the macOS CoreAudio path only.

## Git Tags

- Use annotated tags for milestone checkpoints, not lightweight tags.
- Tag only committed, pushed, verified work. Do not tag a dirty worktree or a half-finished change.
- Tag milestone completion points with the format `m<number>-<short-name>`, for example `m1-floating-island`.
- Keep tag names stable and lowercase; use hyphens between words.
- The tag message should state the milestone in one short sentence, for example `M1: native floating island shell`.
- Push tags explicitly with `git push origin <tag-name>` after creating them.
- Do not reuse or move a pushed tag unless the tag is clearly wrong and the team agrees. Prefer creating a new corrective tag.
- Use tags to mark product/engineering progress checkpoints. Use commits for ordinary code history and branches for active work.
