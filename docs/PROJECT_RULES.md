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
