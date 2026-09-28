# Agent systems and research questions

CARROT DUCK connects persistent interaction context to the way a virtual character responds. The research question is whether recalling a personal detail, at a particular moment and with a particular expression, makes a user feel recognized or intruded upon. The systems below make those choices inspectable. Their internal scores are implementation variables; user experience still needs to be evaluated separately.

## Personality adaptation

[`personality.js`](../src/services/personality.js) maps character settings to five trait values and describes them in the dialogue prompt. In the original [`chat.js`](../src/routes/chat.js) route, a rolling buffer triggers `driftPersonality` once it contains at least 20 messages. Keyword rules propose changes, the initial settings scale their size, and values stay between 10 and 95. Up to 200 snapshots are retained.

This is an authored model of gradual character adaptation. It does not learn a personality model from data or establish psychological validity. The buffer includes both user and assistant messages, so the character's own generated wording can influence later drift. That feedback should be isolated before interpreting a trajectory as adaptation to the user. The current rules change O, E, A and N; C has no nonzero drift rule.

The autonomous demo uses the account's existing traits and settings as style context. It does not run this drift update.

## Affect and confidence

[`occ.js`](../src/services/occ.js) builds a character appraisal state from text, prior state and trait modifiers. Its dimensions include novelty, safety, valence and arousal. [`affectiveSignals.js`](../src/services/affectiveSignals.js) separately records inferred conversational cues, including openness, intensity, boundary risk and supporting evidence. The character's appraisal state and a hypothesis about the user's feelings should not be treated as the same quantity.

The affective confidence score is a heuristic: it starts at 0.35, adds 0.08 per evidence-list entry and 0.08 for text longer than 20 characters, and is capped at 0.88. This is not a calibrated estimate of correctness. Correlated cues, ambiguous wording and negation can all undermine it.

Confidence has several distinct meanings in the repository:

| Score or label | Current use |
| --- | --- |
| Affective signal confidence | Supports recognition-tag eligibility checks in the wider dialogue policy. |
| Memory confidence | A high/medium/low metadata label; low-confidence records are excluded by autonomous retrieval. |
| Relationship direction confidence | A rule-based score derived from explicit relationship cues and their relative weights. |
| PPR outcome confidence | A score assigned by reaction-label rules; it is not a participant's rating of feeling recognized. |

The autonomous planner receives a reduced affect snapshot containing valence, intensity and strategy, with a note that these are hypotheses. The numeric affective confidence and full evidence list are not currently passed into that snapshot. A confidence-sensitive performance policy would therefore be a further implementation step, not an existing feature.

## Relationship continuity and boundaries

[`relationshipProfile.js`](../src/services/relationshipProfile.js) separates familiarity from relationship direction. Familiarity draws on interaction history; explicit cues contribute to direction scores. [`relationalState.js`](../src/services/relationalState.js) summarizes prior recognition outcomes, unanswered contact and decaying boundary pressure. Higher caution can reduce proactive contact or soften memory references. These authored rules support response selection; they are not measurements of a human relationship.

The original chat route updates these records. Autonomous interaction reads existing boundary controls but does not update the relationship profile, save an ongoing emotion state or write formal PPR outcomes. Its explicit memory form and separate turn/playback records define a smaller experimental path.

## Memory, expression and evidence

[`memoryMeta.js`](../src/services/memoryMeta.js) describes memory provenance and confidence. The autonomous service selects active, grounded records, checks generated source IDs against the supplied candidates and proposes a supported performance. A valid source ID does not guarantee that the model interpreted the detail correctly.

[`ppr.js`](../src/services/ppr.js) records candidate recognition events and labels subsequent reactions in the wider dialogue path. Labels such as `full` are rule outputs for inspection. A study would need independent participant reports and transcript review to examine whether these labels correspond to perceived recognition.

The character controller makes the presentation observable through gestures, expressions and speech coordination. [Character capabilities](CHARACTER.md) documents its current limits. Background contact services are included in source but disabled by default in the public local configuration.

## Research context

Yang, Guo and Mousas's [Exploring Familiarity and Knowledgeability in Conversational Virtual Agents](https://doi.org/10.1145/3757062) examines familiar versus unfamiliar agent identity alongside domain knowledge. Familiarity there concerns resemblance to a known person, which differs from CARROT DUCK's interest in continuity built through remembered exchanges. The connection motivates separating a character's information access from the user's interpretation of that access.

Yang, Duque and Mousas's [The Effects of Depth of Knowledge of a Virtual Agent](https://doi.org/10.1109/TVCG.2024.3456148) studies how different knowledge levels affect perceptions of a conversational agent in VR. CARROT DUCK raises a related question about personal context: a correct recollection may still be poorly timed or unwelcome. These papers inform possible evaluation questions; this repository does not reproduce their experiments.

## Proposed evaluation and demonstration

These are proposed comparisons, not completed studies or implemented experiment controls:

| Question | Comparison and observations |
| --- | --- |
| Does a grounded personal reference change perceived recognition? | Compare relevant recall with a generic response, keeping the task and character fixed. Collect perceived recognition, appropriateness and intrusiveness alongside source accuracy. |
| How does presentation change the interpretation of the same reply? | Hold wording and voice constant; compare restrained idle movement with a selected gesture/expression. Record perceived attentiveness and distracting or mismatched behavior. |
| Does acknowledging uncertainty improve the interaction? | First implement confidence-sensitive wording and action selection, then compare it with direct inference under ambiguous cues. Review corrections and perceived appropriateness. |
| Does trait adaptation preserve character continuity? | Compare fixed traits with bounded drift across multiple sessions, isolating user evidence from generated wording. Examine consistency and unwanted change. |

A short, uncut autonomous demonstration should show an invented memory, a related request, the cited record, the selected performance and its playback result. A second example can show an explicit refusal and the restrained response. Keep those software demonstrations separate from evidence about user experience. Before a formal study, specify conditions and measures, plan ordering and sample size, and complete the applicable participant-research review.
