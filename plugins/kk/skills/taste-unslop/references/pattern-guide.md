# Pattern guide

Use these patterns during the scan in `SKILL.md`. A matching word or punctuation mark is not enough
to justify an edit. Change it only when the usage is formulaic, repeated, vague, or wrong for the
requested voice. Wordiness is a clarity edit. Clustered stock diction is a stronger signal than a
single hit.

## Content and evidence

1. **Puffery and promotion.** Cut phrases such as "pivotal moment", "watershed moment", "testament
   to", "evolving landscape", "breathtaking", "nestled", "vibrant", "thriving", and "groundbreaking"
   when facts carry the point better. If the sentence still works after the inflation clause is
   deleted, delete the clause.
2. **Vague authority.** Replace "experts believe", "reports suggest", "studies show", "analysts
   agree", or "independent testing confirms" with a supplied source. If no source exists, preserve
   the uncertainty and flag or remove the unsupported claim. Named, checkable citations stay.
3. **Context-free name-dropping.** Keep a person, company, or publication only when the text
   explains what it contributes. A stack of prestige names ("cited in NYT, BBC, and Wired") is
   weaker than one specific reference. Cut historical-analogy montages ("like the printing press,
   the telegraph, and the internet") unless one parallel does analytical work.
4. **Decorative participial tails.** Delete or expand "highlighting", "showcasing", "ensuring",
   "symbolizing", and "reflecting" endings when they add no supported fact.
5. **Formulaic concessions.** Replace "despite challenges, it continues to thrive" and "while X has
   limitations, it's still remarkable" with the actual limitation and result supplied by the source.
   Vague balance is not a tradeoff.
6. **Generic openings and conclusions.** Cut scene-setting and endings such as "the future looks
   bright", "only time will tell", or "may become one of the most important narratives of the next
   cycle" unless they state a concrete, preferably falsifiable, claim, decision, or next action.
7. **Novelty inflation.** Do not treat an established idea as a coinage ("he introduced a term I
   hadn't heard", "the failure mode nobody's naming"). Describe what the source did with the idea.
   Cut invented labels that are never defined.

## Language

8. **Stock AI diction.** Words such as "delve", "pivotal", "tapestry", "underscore", "vibrant",
   "intricate", and abstract "landscape" are signals only when generic or clustered. Keep the word
   when it is the precise one. Repeated multi-word boilerplate ("the integration of",
   "community-driven", "long-term sustainability") stacked across a piece is the same class: replace
   with a specific claim, or vary genuinely.
9. **Inflated linking verbs.** Replace "serves as", "stands as", "features", "presents", or
   promotional "boasts" with "is" or "has" when precision survives.
10. **Stock frames.** Rewrite repeated "not just X but Y" (including the split form "It isn't X.
    The real story is Y"), forced groups of three, false "from X to Y" ranges, and slot-fill
    templates ("a [adj] step towards [adj] infrastructure", "whether you're X or Y") when a direct
    statement is clearer.
11. **Synonym cycling.** Pick the precise noun and repeat it instead of rotating through
    near-synonyms ("developers… engineers… practitioners… builders").
12. **Vague metaphor and borrowed jargon.** Replace metaphorical "substrate", "vector", "north
    star", "flywheel", or "scaffolding" with the actual mechanism. Preserve established domain terms
    such as vector embeddings, API surface, language primitive, and test harness.
13. **Filler, stacked hedges, and empty intensifiers.** Shorten "in order to", "due to the fact
    that", "moreover", "furthermore", and "in today's X". Collapse hedge stacks ("could potentially",
    "may eventually") to one real qualifier. Drop empty "real" / "actual" / "genuine" on abstract
    nouns unless the sentence names the contrast ("real settlement, not bridged IOUs"). Preserve
    qualifiers that encode real uncertainty; never turn "may" into "will".
14. **Fancy plain words.** Prefer "use", "help", "many", and "if" over "utilize", "facilitate",
    "numerous", and "in the event that" when meaning is unchanged. These are clarity edits, not
    evidence of who wrote the sentence.

## Structure and style

15. **Mechanical rhythm.** Break repeated sentence openings, equal-length paragraphs, and serial
    summaries. Mix short and long sentences with the ideas, not by formula. In longer general prose,
    a narrow looping vocabulary is a cue to name specific things, not to reach for synonyms;
    technical reference that compresses vocabulary on purpose is exempt. Do not force variation
    into text whose form is intentionally regular, and do not sand away deliberate disfluency,
    fragments, or uneven pacing to make the prose "cleaner".
16. **Punctuation monotony.** Reduce repeated em dashes, colons, or parenthetical asides. Keep
    punctuation required by grammar, locale, quoted material, or the style guide; no mark is banned.
17. **Formatting as decoration.** Remove excessive boldface, title-case headings, emoji headers,
    and inline labels that merely repeat the sentence ("**Speed:** Speed improved…"). Convert
    numbered-list inflation ("here are 7 reasons") to the two or three points that matter. On a
    list label, prefer a colon to a period ("**Intros:** …", not "**Intros.** …"). Cut trailing
    hashtag blocks of six or more tags; keep two or three specific tags, or none — and do not treat
    issue refs, hex colors, preprocessor directives, or in-code `#` as tags. Convert a run of five
    or more bare adjective-noun bullets with no verb into prose or into claims that can be checked.
    Preserve formatting that improves navigation or meets the publication format, including genuine
    lists (changelogs, parameters, ingredients).
18. **Dense syntax.** Split a sentence when its dependencies make the reader backtrack. Keep
    clauses together when separating them would hide the relationship.
19. **Unhelpful passive voice.** Name the actor when the actor matters. Keep passive voice when the
    actor is unknown, obvious, or deliberately de-emphasized.
20. **Adverbs propping up weak claims.** Use a stronger verb or a supplied measurement. Do not
    invent a number to replace "significantly" or "quickly".
21. **Typographic inconsistency.** Follow the source language and house style for quotation marks,
    dashes, spacing, capitalization, and headings instead of forcing English ASCII conventions.
    Unweld needless hyphens in open compounds ("research-impact" → "research impact", "in real-time"
    → "in real time") when house style agrees; keep legitimate modifiers ("real-time analytics") and
    do not treat a hyphen fix as authorship evidence.
22. **Rhetorical stalls and engagement hooks.** Lead with the claim instead of "what if there were
    a better way", "so why should you care", "the catch?", "the kicker?", or "here's the thing."
    Delete the hook; state the thing.
23. **Excessive scaffolding.** Merge short text that is over-headed (several headers in a few
    hundred words, or stock "Overview" / "Key Points" / "Conclusion" labels). Cut the one-line
    warm-up that restates the heading. Keep structure that a reader would actually use to navigate.
24. **Modifier stacking.** Cut stacked hyphenated praise ("a high-quality, well-architected,
    future-proof solution") to the modifier that matters. Individual hyphens may be correct.

## Chat, register, and meta

25. **Stock assistant framing.** Remove empty openings and closings such as "Of course", "Great
    question", "Certainly", "I hope this helps", and "Let me know if". Cut "let's explore" /
    "let's break this down" when they only delay the point. Skip acknowledgment loops ("you're
    asking about", "to answer your question"). Keep a direct next step when one exists.
26. **Sycophancy and recap-flattery.** Replace automatic agreement with the answer or evidence. Do
    not open a reply by summarizing the other person's own work back at them as praise; substance
    first, and a short thanks only if it is warranted.
27. **Cutoff disclaimers.** State the exact missing evidence or omit the unsupported passage. Never
    disguise a guess as "details are limited" or "as of my last update".
28. **Speculative gap-filling.** Cut hedged invention that hides a missing fact ("maintains a low
    profile", "likely began his career", "appears to have studied"). Unlike a cutoff disclaimer,
    this does not admit the gap. Replace only with a sourced fact from the draft or an
    authoritative lookup; otherwise flag the gap.
29. **Writing about the writing.** Cut "this article will delve into" and similar road signs when
    the text can make the point directly.
30. **Feeling, significance, and candor without mechanism.** Replace reusable mood claims
    ("what surprised me most", "I was fascinated to discover", "SQL you can read") with a
    source-backed behavior, example, or number — or cut. Cut lingering-attention frames ("the line
    I keep coming back to", "I can't stop thinking about this") unless a reason follows. Cut
    self-labeling after a list ("that last move is the contrarian one") and reader-steering cues
    ("it's worth noting", "interestingly", "this is the interesting part") when the fact can stand
    alone. Cut narrated candor ("I want to be upfront", "two caveats I would rather flag than let
    you discover later"); keep the disclosure itself, including real conflict-of-interest wording.
31. **Reasoning-chain artifacts.** Remove "let me think step by step", "breaking this down", and
    numbered internal monologue. State the conclusion, then the evidence.
32. **Wall-of-text replies.** In conversational registers (issue/PR comments, chat, DMs), break a
    dense reply-length block at thought boundaries. Do not apply this to long-form prose, docs, or
    a deliberately tight paragraph.
33. **Tool fingerprints.** Fill or delete shipped placeholders (`[Your Name]`, `[INSERT SOURCE]`,
    `2025-XX-XX`). Strip leaked chat citation tokens (`citeturn0search0`, `oai_citation`,
    `contentReference[oaicite:…]`). Strip `utm_source` values that name an AI product; leave the
    rest of the URL intact.

## Diagnostics

These are writer-side tests, not findings by themselves.

- **Reshuffle.** If two body paragraphs can swap places without breaking the piece, the draft is a
  list of points, not a building argument. Add the missing through-line, or make the list explicit.
- **Treadmill.** For each paragraph, name the one fact, claim, or turn it adds. If there isn't one,
  cut it. If there is, lead with it.

## Provenance

Pattern classes adapted from the Pattern reference in
[avoid-ai-writing](https://github.com/conorbronsdon/avoid-ai-writing) (MIT), rewritten here as
editing signals. That catalog's replace-on-sight word lists, em-dash bans, numeric type-token
thresholds, and detector scoring are not part of this skill.
