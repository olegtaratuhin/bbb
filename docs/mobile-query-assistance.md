# Mobile query-assistance release checklist

This checklist is the release contract for the Beads query editor on narrow
and coarse-pointer surfaces. It separates checks that can run in CI from
checks that require a rendered BB client or a real device.

## User behavior

- **Raw mode:** users can type or paste the exact Beads expression and keep
  editing it directly.
- **Assistance mode:** **Quick filters** opens presets, recent valid queries,
  and the structured builder. Applying any option writes the serialized query
  back into the raw field.
- **Recovery:** an incomplete expression such as `status=` remains editable
  and offers completion; an invalid expression such as `status=unknown` shows
  a diagnostic and is blocked before `bd` runs.
- **Privacy:** recent history is local-only, capped at eight valid unique
  entries, and removable one item at a time. Empty and invalid expressions
  are never stored.

The portable contract in [`../beads-query-language/README.md`](../beads-query-language/README.md)
is authoritative for field metadata, UTF-16 replacement ranges, IME policy,
safe-area/keyboard behavior, and builder serialization.

## Automated gates

Run these from the repository root. The implementation owner investigates
failures; the release owner decides whether a known upstream compatibility
difference is acceptable.

| Gate | Command | Owner | Required |
| --- | --- | --- | --- |
| Unit and UI tests | `npm test` | implementation owner | Yes |
| Query/CLI compatibility | `npm run test:compat` | query owner | Yes |
| Type safety | `npm run typecheck` | implementation owner | Yes |
| Packaged plugin | `npm run build` | release owner | Yes |

## Rendered-client gates

These checks are not reproduced by jsdom. Record BB version, browser, viewport
width, and whether the test used a local or Connect project before closing a
release task.

- [ ] Wide, medium, narrow, and phone-like containers keep the query field,
  submit action, diagnostics, and assistance trigger reachable.
- [ ] Opening the assistant does not hide the active field behind the soft
  keyboard; the bottom sheet respects the safe-area inset.
- [ ] Completion works with touch and restores focus after selection.
- [ ] Builder rows expose labels and 44 CSS pixel targets; adding/removing a
  row preserves explicit connectors.
- [ ] Valid, incomplete, invalid, and compound queries produce the expected
  raw text and result/diagnostic state.

## Remote/device gates

- [ ] BB Connect shows the same project and query results as local BB.
- [ ] The selected repository host, not the phone/browser filesystem, runs
  `bd`; disconnected or unsupported hosts show an actionable error.
- [ ] iOS Safari and Android Chrome checks are recorded when devices are
  available. If no device or browser runtime is available, leave the
  corresponding Beads acceptance ticket open and record the limitation rather
  than claiming device acceptance.

Known current limitation: this source checkout has automated coverage but no
paired handset or available in-app browser runtime. The device and remote
visual acceptance tickets remain the source of truth for those gates.
