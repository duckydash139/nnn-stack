# Brief: Plan one week together

Reconciled with: none
Milestone: M1

## Glossary
- Family: The four people who share one weekly plan.
- Suggestion: A dish name of at most 80 characters proposed for one day of the week.

## New

### accounts (ACC)
- WHEN a family member asks to sign in with their email address, THE SYSTEM SHALL email them a sign-in link that works once within 15 minutes.

### suggestions (SUG)
- WHEN a family member suggests a dish for a day, THE SYSTEM SHALL show it under that day for every family member within 5 seconds.
- WHEN a family member votes for a suggestion, THE SYSTEM SHALL add one to its vote count.

## Changes
None.

## Journeys

### Suggest and vote on a dinner
Flow: dinner-week
Criticality: critical
Persona: A teenager in the family, on a phone browser
Context: Signed in, next week has no suggestions yet
Intent: Get their favourite dish onto Monday
Steps:
1. Suggest a dish for Monday
2. Vote for it
Lines:
- WHEN a family member suggests a dish for a day, THE SYSTEM SHALL show it under that day for every family member within 5 seconds.
- WHEN a family member votes for a suggestion, THE SYSTEM SHALL add one to its vote count.

## Not expectations
None.

## Open questions
- What happens when two suggestions for the same day have the same number of votes?
- Can a parent unlock a locked week, and who else may lock it?
