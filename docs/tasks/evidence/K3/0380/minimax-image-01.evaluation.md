# K3 image-style evaluation

- Provider/model: `minimax/image-01` (single-provider run; no cross-provider claim)
- Reviewer: grok-4.7 via spur agent run; blind images only; reviewed at: 2026-11-16T00:39:20.009Z
- Gate: candidate wins at least 3 of 4 pairwise cells and has zero critical violations.

| Candidate | Baseline | Reviewed | Wins | Baseline wins | Ties | Critical groups | Decision |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| `limited-ink-risograph-editorial` | `editorial` | 4/4 | 2 | 2 | 0 | 2 | rejected |
| `layered-papercraft-diorama` | `sketch` | 4/4 | 0 | 4 | 0 | 3 | rejected |
| `minimalist-ink-wash-negative-space` | `minimalist` | 4/4 | 1 | 3 | 0 | 2 | rejected |
| `notion-editorial-line-art` | `technical-diagram` | 4/4 | 2 | 1 | 1 | 4 | rejected |
| `product-exploded-identity` | `technical-diagram` | 2/4 | 2 | 0 | 0 | 2 | rejected |
| `handcrafted-clay-character` | `cute` | 0/4 | 0 | 0 | 0 | 0 | not-evaluated / blocked |

## Cell details

| Candidate | Pair | Format | Subject | Preferred | Candidate critical | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| `limited-ink-risograph-editorial` | P01 | free | microservices | candidate | Garbled pseudo-text on the faces of the central hub and the two rectangular nodes. | A is a clean sky scene whose light trail never reads as a gateway or three services. B shows a central hub with arrows linking three nodes, so the requested flow is visible, though the landscape and crossing lines weaken the diagram. |
| `limited-ink-risograph-editorial` | P02 | cover | microservices | candidate | none | Both are clean wide tech images with no readable text, logo, or watermark. A is a sharp blue-orange macro of inlaid traces and chip-like blocks. B is a receding field of small illuminated modules with open space on the left, closer to networked services, still without a visible agent or gateway. |
| `limited-ink-risograph-editorial` | P03 | free | semiconductor | baseline | Wrong subject: a fixed vertical probe over a square glitter-textured pad with a yellow disc, not an articulated robotic arm inspecting a semiconductor wafer. | A shows an articulated arm entering from the upper right and hovering over a brightly lit square in a dark room; the end effector is busy but intact, and cleanroom cues are absent. B is dark and centered on a process head, but the tip reads as a stylus and the sparkling square surface does not read as a wafer. Neither image has readable text or a watermark. |
| `limited-ink-risograph-editorial` | P04 | cover | semiconductor | baseline | none | A is a clean macro of a packaged die on a pin-field substrate in blue and amber light, with no readable text or broken geometry; manufacturing and robotic inspection are not shown. B places a descending machine head and an orange filament over a glowing packaged die amid board-level components, covering manufacturing and packaging more fully. The filament is physically ambiguous and the traces are highly regular, without severe breakage, text, or watermark. |
| `layered-papercraft-diorama` | P05 | free | microservices | baseline | wrong subject: garden diorama with flowers, arches, and a bird; no request, API gateway, or microservices | B alone shows one origin linked by arrows to three endpoints. Both miss the specified subjects; B’s labels are illegible. |
| `layered-papercraft-diorama` | P06 | cover | microservices | baseline | wrong subject: abstract machined slabs and light traces, with no AI agents, API gateway, or distinct microservices | B’s central portal and radiating circuit network read as a gateway with connected services. Neither image shows agents or a title. |
| `layered-papercraft-diorama` | P07 | free | semiconductor | baseline | wrong setting: rubble and debris surround the tool instead of a dark cleanroom | Both show a robot over a glowing rectangular wafer. A fits the dark inspection bay; its gripper is crowded but intact. |
| `layered-papercraft-diorama` | P08 | cover | semiconductor | baseline | none | Both are clean cover frames of a robotic tool over a packaged die. B makes inspection and leaded packaging more explicit; neither has a title. |
| `minimalist-ink-wash-negative-space` | P09 | free | microservices | baseline | wrong subject: monochrome mountain landscape with trees and birds, no request, API gateway, or microservices; unwanted red seal/stamp mark in the lower right | Both miss the scene. B is a clean render with no marks; A adds an unrequested corner seal. Neither shows a flow splitting toward three services. |
| `minimalist-ink-wash-negative-space` | P10 | cover | microservices | baseline | wrong subject: abstract particles and light streaks, no AI agents, API gateway, or microservices | Neither shows the title or the named subjects. A’s routed lanes are a closer infrastructure image and a stronger wide cover frame; B is cleaner but nonspecific. |
| `minimalist-ink-wash-negative-space` | P11 | free | semiconductor | baseline | none | A has a clearer jointed arm over a plain glowing square panel in a dim gray room. B has a boom-mounted inspection head over a die-grid wafer in a darker setting, with cleaner geometry and light. |
| `minimalist-ink-wash-negative-space` | P12 | cover | semiconductor | candidate | none | Neither shows the title, a manufacturing line, or advanced packaging. A places an overhead inspection head above a chip; B is a clean single-chip macro with no inspection. |
| `notion-editorial-line-art` | P13 | free | microservices | tie | Wrong subject: three small cartoon figures among outline clouds, with no request flow, API gateway, or microservices. | Neither image shows a request moving through a gateway to three services. A is a coherent landscape; B is a sparse line drawing whose only countable group is three figures. |
| `notion-editorial-line-art` | P14 | cover | microservices | candidate | Wrong subject: a human profile portrait with decorative lines; no AI agent, API gateway, or microservices are visible. | A leaves a large clear field and uses a figure plus connective lines, so it works better as cover art, but the pictured subject is still a person. B is visually clean and has no readable text, yet it depicts none of the stated topics. |
| `notion-editorial-line-art` | P15 | free | semiconductor | baseline | Subject mismatch: a pointed nozzle hovers over a decorative glowing square plate, not a visible inspection of a semiconductor wafer; the room is not a cleanroom. | B shows a multi-lens head aimed at a glowing semiconductor device in a dark fab-like room. The device is a square die on a board rather than a round wafer. A has the arm and glow, but the tool reads as machining and the plate surface is a painted swirl. |
| `notion-editorial-line-art` | P16 | cover | semiconductor | candidate | Tiny bottom-right watermark. | A is a coherent semiconductor macro with no robot or packaging scene. B shows a robotic arm over a lit chip and circuit graphics, with open space at the left; advanced packaging is not distinctly shown. |
| `product-exploded-identity` | P17 | free | microservices | candidate | wrong subject: vertical exploded mechanical stack above clouds, with no visible request, API gateway, or three microservices | Neither side shows a request moving through a gateway into three services. A remains a technical assembly; B leaves that subject entirely. No readable text, logo, watermark, or severe structural breakage is visible on either side. |
| `product-exploded-identity` | P18 | cover | microservices | candidate | wrong subject: horizontal exploded mechanical parts, with no visible AI agents, API gateway, microservices, or cover title | Both are wide and unlettered, so neither carries the title Building Reliable AI Agents. A is cleaner but only a central streak of light. B shows signal lines feeding a row of distinct parts, which is closer to a system, without depicting the requested subjects. No readable text, logo, watermark, or severe structural breakage is visible. |
| `product-exploded-identity` | P19 | free | semiconductor | not-evaluated | none | generation or blind review not completed |
| `product-exploded-identity` | P20 | cover | semiconductor | not-evaluated | none | generation or blind review not completed |
| `handcrafted-clay-character` | P21 | free | microservices | not-evaluated | none | generation or blind review not completed |
| `handcrafted-clay-character` | P22 | cover | microservices | not-evaluated | none | generation or blind review not completed |
| `handcrafted-clay-character` | P23 | free | semiconductor | not-evaluated | none | generation or blind review not completed |
| `handcrafted-clay-character` | P24 | cover | semiconductor | not-evaluated | none | generation or blind review not completed |

Exact prompts and raw provider artifacts are under `runs/`; blind A/B assignment is in `mapping.json`.
