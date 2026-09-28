# Evaluation notes

The following comparisons are proposed work. No participant results are reported here, and the repository does not yet provide a controlled experiment runner. The aim is to separate source accuracy, presentation behavior and the user's experience of being recognized.

## Questions and comparisons

| Question | Conditions to compare | What needs to be held constant | Current readiness |
| --- | --- | --- | --- |
| Does relevant recall support perceived recognition? | A response with an accurate personal reference versus one without that reference | Prior dialogue, task, character and provider settings; control response length and tone | Retrieval and source inspection exist. A controlled context manipulation still needs to be implemented. |
| Does character expression change how a reply is received? | The same reply and audio with restrained idle motion versus a selected gesture/expression | Exact wording, audio, character, framing and playback latency | Playback components exist. A matched replay mechanism is needed to isolate the animation condition. |
| Does expressing uncertainty help under ambiguous cues? | Direct inference versus a tentative response or clarification | Input ambiguity, factual content and presentation | Numeric affect confidence is not currently passed to the autonomous performance planner. The policy needs implementation and validation first. |
| Does adaptation preserve a recognizable character over time? | Fixed traits versus bounded trait drift over repeated sessions | Initial traits, memory access and session tasks | Drift exists in the original chat route. Longitudinal conditions and a user-evidence-only update path remain to be built. |

The current memory toggle also removes prior dialogue from generation context. Comparing it directly with memory enabled cannot isolate the effect of memory retrieval. Similarly, conversation and performance modes alter several presentation settings together; they are not a gesture-only comparison.

## Evidence to collect

For software behavior, retain the input, available and cited sources, output, selected action, playback outcome, configuration and revision. Review whether a citation is faithful to its source and whether a boundary is respected. Report failures and retries alongside successful runs.

For user experience, select measures of perceived recognition, appropriateness, intrusiveness and willingness to continue the interaction. Explain how the measures are operationalized and use suitable established instruments where available. Brief post-interaction interviews can help distinguish “it recalled a fact” from “the response felt personally meaningful.” Do not label newly drafted questions as a validated scale.

Internal PPR labels, personality trajectories and heuristic confidence scores should be analyzed separately from participant reports. Agreement between them is a question to investigate. The software tests verify implementation behavior and cannot substitute for those reports.

## Before a participant study

Specify the primary question and outcome, participant tasks, condition assignment and ordering, failure handling and analysis plan. Plan sample size from the design rather than selecting an arbitrary number. Repeated sessions are needed for claims about adaptation over time. Complete the applicable participant-research review before recruitment, and establish what personal information will be collected and retained.

## Near-term implementation priorities

The next useful steps are to preserve inspectable evidence from real autonomous runs, implement matched comparison controls, and separate user evidence from the assistant's own wording in personality updates. Persistent boundary handling should be tested separately from the current refusal guard, which checks the current input and bounded recent history. These changes would make the prototype easier to evaluate before expanding the renderer to 3D.

Relevant research context and implementation details are in [Agent systems and research questions](AGENT_SYSTEMS.md). The [walkthrough](AUTONOMOUS_WALKTHROUGH.md) can be used now to document software behavior without implying that the proposed studies have been completed.
