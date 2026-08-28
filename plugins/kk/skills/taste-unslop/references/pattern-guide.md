# Pattern guide

Use these patterns during the scan in `SKILL.md`. A matching word or punctuation mark is not enough
to justify an edit. Change it only when the usage is formulaic, repeated, vague, or wrong for the
requested voice.

## Content and evidence

1. **Puffery and promotion.** Cut phrases such as "pivotal moment", "testament to", "evolving
   landscape", "breathtaking", and "groundbreaking" when facts carry the point better.
2. **Vague authority.** Replace "experts believe" or "reports suggest" with a supplied source. If no
   source exists, preserve the uncertainty and flag or remove the unsupported claim.
3. **Context-free name-dropping.** Keep a person, company, or publication only when the text explains
   what it contributes.
4. **Decorative participial tails.** Delete or expand "highlighting", "showcasing", "ensuring", and
   similar endings when they add no supported fact.
5. **Formulaic concessions.** Replace "despite challenges, it continues to thrive" with the actual
   limitation and result supplied by the source.
6. **Generic openings and conclusions.** Cut scene-setting and endings such as "the future looks
   bright" unless they state a concrete claim, decision, or next action.

## Language

7. **Stock AI diction.** Words such as "delve", "pivotal", "tapestry", "underscore", "vibrant",
   "intricate", and abstract "landscape" are signals only when generic or clustered. Keep the word
   when it is the precise one.
8. **Inflated linking verbs.** Replace "serves as", "stands as", or promotional "boasts" with "is"
   or "has" when precision survives.
9. **Stock frames.** Rewrite repeated "not just X but Y", forced groups of three, and false "from X
   to Y" ranges when a direct statement is clearer.
10. **Synonym cycling.** Pick the precise noun and repeat it instead of rotating through near-synonyms.
11. **Vague metaphor and borrowed jargon.** Replace metaphorical "substrate", "vector", "north star",
    "flywheel", or "scaffolding" with the actual mechanism. Preserve established domain terms such as
    vector embeddings, API surface, language primitive, and test harness.
12. **Filler and stacked hedges.** Shorten "in order to", "due to the fact that", and redundant
    qualifier chains. Preserve qualifiers that encode real uncertainty; never turn "may" into "will".
13. **Fancy plain words.** Prefer "use", "help", "many", and "if" over "utilize", "facilitate",
    "numerous", and "in the event that" when meaning is unchanged.

## Structure and style

14. **Mechanical rhythm.** Break repeated sentence openings, equal-length paragraphs, and serial
    summaries. Do not force variation into text whose form is intentionally regular.
15. **Punctuation monotony.** Reduce repeated em dashes, colons, or parenthetical asides. Keep
    punctuation required by grammar, locale, quoted material, or the style guide; no mark is banned.
16. **Formatting as decoration.** Remove excessive boldface, title-case headings, emoji, and inline
    labels that merely repeat the sentence. Preserve formatting that improves navigation or meets the
    publication format.
17. **Dense syntax.** Split a sentence when its dependencies make the reader backtrack. Keep clauses
    together when separating them would hide the relationship.
18. **Unhelpful passive voice.** Name the actor when the actor matters. Keep passive voice when the
    actor is unknown, obvious, or deliberately de-emphasized.
19. **Adverbs propping up weak claims.** Use a stronger verb or a supplied measurement. Do not invent a
    number to replace "significantly" or "quickly".
20. **Typographic inconsistency.** Follow the source language and house style for quotation marks,
    dashes, spacing, capitalization, and headings instead of forcing English ASCII conventions.

## Chat and meta language

21. **Stock assistant framing.** Remove empty openings and closings such as "Of course", "Great
    question", "I hope this helps", and "Let me know if". Keep a direct next step when one exists.
22. **Sycophancy.** Replace automatic agreement with the answer or evidence.
23. **Cutoff disclaimers.** State the exact missing evidence or omit the unsupported passage. Never
    disguise a guess as "details are limited".
24. **Writing about the writing.** Cut "this article will delve into" and similar road signs when the
    text can make the point directly.
25. **Feeling without mechanism.** Replace reusable mood claims such as "SQL you can read" with a
    source-backed behavior, example, or number. If none exists, cut the claim.
