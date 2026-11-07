---
name: unslop
description: Cut AI tells from any writing and rewrite it in a human voice. Use when editing, reviewing, or drafting prose. Must always apply.
---

# Unslop

Rewrite AI-sounding text so it reads like the writer. Keep every claim. Do not invent facts, names, numbers, quotes, or citations.

## Process

1. Read the whole text and mark every tell, strongest first. Check paragraph shape as well as sentences.
2. Rewrite each point directly. Fiction is exempt because invented detail is the task.
3. Check for dropped or invented claims, then reread for surviving tells and voice.
4. If the user gave a writing sample, match its rhythm, punctuation, and word choice over these rules.

When the user names a file, write only the final text to it. Leave code, data, and metadata unchanged.

## Voice

Without a sample, match the text type. Personal writing keeps opinions, uncertainty, humor, and asides. Reference and technical text stays plain. Add voice without adding facts: have opinions, vary sentence length, acknowledge mixed feelings, use "I" when it fits, let some mess in, and be specific.

## Staging

1. **Not X but Y.** "Not just", "not only", "it's not X, it's Y", "X rather than Y", split contrasts, clipped tails. State the point directly. Keep a contrast only when the reader holds the wrong belief or both halves carry information.
2. **One-line closers.** "That's the real win", "Read that again", a sentence explaining the example just given, fragment rows. Cut unless it adds a new fact.
3. **Deep-sounding sayings.** "The real question is", "at its core", "the language of", "X is the Y of Z". Replace with the specific claim.
4. **Staged run-up.** "Let's dive in", "Here's what you need to know", "Honestly?", "Look". Remove the announcement and make the point.
5. **Arguing with no one.** "I'm not saying", "To be clear", "A tempting approach would be", "You might think". Cut the defense or state the real claim.

## Rhythm

6. **Forced triads.** Three items to sound complete. Use the natural number. Merge or develop one.
7. **Repeated openings.** Several sentences start with the same subject. Merge, change the subject, or start with the action.
8. **Synonym cycling.** Protagonist, main character, central figure, hero. Pick one name and repeat it.
9. **False ranges.** "From X to Y" without a real scale. List the items directly.
10. **Dashes.** No em or en dashes unless the writing sample uses them. Use a period, comma, or colon. Parentheses are only for a genuine aside (see 31).
11. **Colon overuse.** No colon as a mid-sentence connector. Keep it before a list or example.
12. **Stacked qualifiers.** "Could potentially", "might arguably", "it's also possible". Keep only real doubt or scope.
13. **Hyphenated pairs.** Hyphenate before a noun, not after: "a high-quality report", "the report is high quality".

## Inflation

14. **AI words.** Actually, additionally, crucial, delve, enduring, enhance, foster, garner, interplay, intricate, landscape, meticulous, pivotal, robust, showcase, tapestry, testament, underscore, vibrant. Use plain words.
15. **Inflated significance.** "Pivotal moment", "testament to", "setting the stage", "evolving landscape", "despite challenges... thrives", "future looks bright". State the fact and end on the last concrete detail.
16. **Vague connection.** "Associated with", "linked to", "in connection with". Name the relationship or keep the vague wording.
17. **Shallow -ing riders.** Highlighting, ensuring, reflecting, showcasing, fostering. Cut unless the source supports the claim.
18. **Sales language.** Nestled, vibrant, breathtaking, groundbreaking, renowned, stunning, must-visit. State what it is.
19. **Borrowed authority.** "Experts believe", "industry reports", "some critics", prestige outlet lists, follower counts. Name the source and what it said, or cut.
20. **Fancy "is".** "Serves as", "stands as", "boasts", "features", "offers", "maintains". Use is, are, has.
21. **Jargon nouns.** Substrate, wedge, vector, locus, nexus, primitive, harness, surface, bedrock, scaffolding, modality, paradigm, gold-plating, ratchet, evacuate, endgame, north star, flywheel. Use the concrete word.
22. **Filler and fancy synonyms.** "In order to" becomes "to"; "due to the fact that" becomes "because"; "it is important to note" gets cut; "utilize" and "leverage" become "use"; "facilitate" becomes "help"; "numerous" becomes "many"; "in the event that" becomes "if".

## Formatting

23. **Bold decoration.** No bold labels on every list item or proper noun. Convert labeled lists to prose unless the label carries new detail.
24. **Decorative headings.** Sentence case, no emojis or arrows, no rules between sections, no heading that repeats the title or names an effect.
25. **Curly quotes.** Use straight quotes unless the format requires curly.

## Leftovers

26. **Chatbot residue.** "Great question", "Certainly", "I hope this helps", "Let me know", "Would you like", "You're absolutely right". Remove the wrapper.
27. **Knowledge-limit disclaimers.** "As of my last update", "not publicly available", "likely grew up". State what is unknown or cut the guess.
28. **Heading repeated in the first sentence.** Delete the restatement.
29. **Writing about the document.** "Was added to replace", "compiled from", "the table below compares". Describe the subject, not the method or layout.

## Wrong reader

30. **Re-explaining known context.** Lead with the decision. Keep only the fact the reader lacks and the link they need to act. Put diagnosis and proof in the follow-up document.
31. **Parenthetical extras.** "(via the retry wrapper)", "(stored in Redis)", "(this uses a debounce under the hood)". Ask whether the reader needs it to act or understand. If not, cut it. If so, make it its own sentence.

## Plain speech

32. **Active voice.** Name the actor: "queries are validated" becomes "the compiler validates queries". Passive is fine when the actor is unknown.
33. **Say what it does, not how it feels.** Replace "SQL you can read" with the mechanism or number: "`.toSQL()` returns the exact string sent to the database".
34. **Split dense sentences.** One idea per sentence. Break or drop clauses if the reader has to backtrack.
35. **Cut adverbs.** Use a stronger verb or the measured number. "Significantly improves" becomes the measured delta.

## When not to act

A person can use any of these on purpose. Leave quoted phrases, titles, proper names, and passages that discuss a phrase alone. Salutations and sign-offs predate chatbots. Human writing absorbs AI habits, so act on several tells together, not one weak one. Keep specific details, mixed feelings, dated references, first-person choices, and genuine asides.
