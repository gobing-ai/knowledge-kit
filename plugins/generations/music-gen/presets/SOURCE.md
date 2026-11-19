# Preset provenance and evidence discipline

Every preset file carries a `provenance` block (`authoring_source`, `authored_at`, `status`). The
loader rejects a file without one, and rejects any `status` outside
`authored | evidence-pending | verified` — a preset may not claim a quality result it has not
produced.

| Status | Meaning |
| --- | --- |
| `authored` | Written from the design contract. No generated take has been judged against it yet. |
| `evidence-pending` | Queued for a real generation round; the round has not concluded. |
| `verified` | A real generated take was reviewed and accepted for this format × theme pair. **Requires a generation id.** |

## Where these presets come from

`formats/*.yaml` and `themes/*.yaml` were authored for task 0399 (feature D8) from two sources inside
this repository: the frozen contract in `docs/design/music-gen.md` section 5 (precedence, portability,
`lyrics_policy`, clip's ~30 s ceiling) and the authoring form in
`plugins/generations/music-gen/README.md`. No third-party prompt corpus was imported, so there is no
licence obligation and no reference image set to vendor.

Nothing here names a provider, a base URL or an API model id. `model: pro|clip` is the instance's own
selector; the mapping to a concrete upstream model id belongs to the instance, so a provider swap
leaves every preset byte-identical. Prices are user config (`music.prices`, task 0400) for the same
reason.

## Not shipped

`corporate-tech` and `xhs-pop` are deliberately absent. Both are plausible themes, but neither has
produced a generated take this feature could point at, and K3's lesson
(`plugins/generations/image-gen/presets/SOURCE.md`) is that bulk-imported presets without a generation
review are presets nobody can trust. They land in a later evidence round — authored from a real
listening comparison, not from a guess.

## Promotion

A preset moves to `verified` only when task 0404's dogfood round generates the track, the operator
reviews it, and the evidence note names the generation id and the date. Until then the index in
`README.md` prints `authored`, and that is the honest answer.
