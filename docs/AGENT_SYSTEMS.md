# Agent systems and research questions

CARROT DUCK connects persistent interaction context to the way a virtual character responds. The research question is whether recalling a personal detail, at a particular moment and with a particular expression, makes a user feel recognized or intruded upon. The systems below make those choices inspectable.

## Personality adaptation

[`personality.js`](../src/services/personality.js) maps character settings to five trait values and describes them in the dialogue prompt. In the original [`chat.js`](../src/routes/chat.js) route, a rolling buffer triggers `driftPersonality` once it contains at least 20 messages. Keyword rules propose changes, the initial settings scale their size, and values stay between 10 and 95. Up to 200 snapshots are retained.

The adaptation rules use both user and assistant messages in the buffer. The character's generated wording can therefore influence later drift. The current rules change O, E, A and N; C remains unchanged.

The autonomous demo uses the account's existing traits and settings as style context; drift updates belong to the original chat route.

## Affect and confidence

[`occ.js`](../src/services/occ.js) builds a character appraisal state from text, prior state and trait modifiers. Its dimensions include novelty, safety, valence and arousal. [`affectiveSignals.js`](../src/services/affectiveSignals.js) separately records inferred conversational cues, including openness, intensity, boundary risk and supporting evidence.

The affective confidence score is a heuristic: it starts at 0.35, adds 0.08 per evidence-list entry and 0.08 for text longer than 20 characters, and is capped at 0.88.

Confidence has several distinct meanings in the repository:

| Score or label | Current use |
| --- | --- |
| Affective signal confidence | Supports recognition-tag eligibility checks in the wider dialogue policy. |
| Memory confidence | A high/medium/low metadata label; low-confidence records are excluded by autonomous retrieval. |
| Relationship direction confidence | A rule-based score derived from explicit relationship cues and their relative weights. |
| PPR outcome confidence | An internal score assigned by reaction-label rules. |

The autonomous planner receives a reduced affect snapshot containing valence, intensity and strategy, marked as inferred. A future confidence-sensitive performance policy would need to pass the numeric confidence and supporting evidence to the planner.

## Relationship continuity and boundaries

[`relationshipProfile.js`](../src/services/relationshipProfile.js) separates familiarity from relationship direction. Familiarity draws on interaction history; explicit cues contribute to direction scores. [`relationalState.js`](../src/services/relationalState.js) summarizes prior recognition outcomes, unanswered contact and decaying boundary pressure. Higher caution can reduce proactive contact or soften memory references.

The original chat route updates relationship records, emotion state and PPR outcomes. Autonomous interaction reads existing boundary controls and stores separate turn/playback records. Its memory form provides explicit memory entry.

## Memory, expression and evidence

[`memoryMeta.js`](../src/services/memoryMeta.js) describes memory provenance and confidence. The autonomous service selects active, grounded records, checks generated source IDs against the supplied candidates and proposes a supported performance.

[`ppr.js`](../src/services/ppr.js) records candidate recognition events and labels subsequent reactions in the wider dialogue path. Labels such as `full` are rule outputs for inspection. A study would need independent participant reports and transcript review to examine whether these labels correspond to perceived recognition.

The character controller makes the presentation observable through gestures, expressions and speech coordination. [Character capabilities](CHARACTER.md) documents its current limits. Background contact services are included in source but disabled by default in the public local configuration.

## Research context

[LPM](https://large-performance-model.github.io/) is a design reference for coordinating character performance with dialogue. CARROT DUCK uses authored Live2D controls and a bounded performance planner. The evaluation questions concern how people interpret remembered personal details when those details accompany a character response.

## Proposed evaluation and demonstration

The [autonomous walkthrough](AUTONOMOUS_WALKTHROUGH.md) provides concrete demonstration inputs and inspection steps. [Evaluation notes](EVALUATION.md) separates immediately demonstrable behavior from the controls still needed for a study.

Proposed comparisons:

| Question | Comparison and observations |
| --- | --- |
| Does a grounded personal reference change perceived recognition? | Compare relevant recall with a generic response, keeping the task and character fixed. Collect perceived recognition, appropriateness and intrusiveness alongside source accuracy. |
| How does presentation change the interpretation of the same reply? | Hold wording and voice constant; compare restrained idle movement with a selected gesture/expression. Record perceived attentiveness and distracting or mismatched behavior. |
| Does acknowledging uncertainty improve the interaction? | First implement confidence-sensitive wording and action selection, then compare it with direct inference under ambiguous cues. Review corrections and perceived appropriateness. |
| Does trait adaptation preserve character continuity? | Compare fixed traits with bounded drift across multiple sessions, isolating user evidence from generated wording. Examine consistency and unwanted change. |

The walkthrough follows an invented memory through retrieval and playback. A second example covers refusal handling. The [evaluation notes](EVALUATION.md) describe study design and participant measures.
