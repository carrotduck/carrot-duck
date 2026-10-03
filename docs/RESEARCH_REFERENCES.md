# Research references and design rationale

CARROT DUCK asks when a response feels grounded in a particular relationship. I use **Perceived Personal Recognition (PPR)** as a working term for this question. These references inform the character design and proposed evaluation.

## Choosing a character and revising its personality

**Jayasiriwardene et al., [From Fixed to Flexible: Shaping AI Personality in Context-Sensitive Interaction](https://arxiv.org/abs/2601.08194v2) (2026, v2).** Participants explicitly adjusted an AI's personality in different conversational contexts. The study informs Duck's approach to character configuration: users choose keywords to set the character's initial traits.

Duck translates these choices into initial trait values through authored rules in [`personality.js`](../src/services/personality.js). In the chat route, predefined text patterns trigger small, bounded changes; conscientiousness remains unchanged. A proposed comparison would examine whether users understand and welcome these changes, alongside fixed settings and explicit user adjustment.

**Lo, Huang and Lo, [LLM-based robot personality simulation and cognitive system](https://doi.org/10.1038/s41598-025-01528-8) (2025).** This system combines personal constructs and Cattell's 16PF with an LLM, and uses IPIP-NEO measures in evaluation.

Two further papers help frame the onboarding question:

- **Burgess and Jones, [The Female Video Game Player-character Persona and Emotional Attachment](https://doi.org/10.21153/psj2020vol6no2art963).** Their discussion of Aloy in *Horizon Zero Dawn* examines attachment to a developer-authored character with a distinct persona. It frames the relationship between the player and the character they guide.
- **Zaini et al., [Action Before Empathy: How Player Agency Shapes Emotional Connection in Interactive Narrative](https://doi.org/10.1145/3772363.3799339) (2026).** Qualitative findings from this preliminary study suggest a role for responsibility in emotional connection during consequential narrative choices. For Duck, the onboarding question is whether participating in character setup shapes the user's sense of authorship and connection.

## From appraisal to expression

**Smith and Carette, [Design Foundations for Emotional Game Characters](https://doi.org/10.7557/23.6175).** Their proposed architecture separates the appraisal of an event from the character's expression. Emotion state changes over time, and expression thresholds determine when visible behaviour is triggered.

This separation informs Duck's emotional response design. Its OCC-inspired [`occ.js`](../src/services/occ.js) performs heuristic appraisal and blends the previous state with the new appraisal. [`expressionPlan.js`](../src/services/expressionPlan.js) then prepares the response plan.

## Continuity between conversations

**Krueger and Roberts, [Real Feeling and Fictional Time in Human-AI Interactions](https://doi.org/10.1007/s11245-024-10046-7) (2024).** This philosophical account examines how imagined temporal continuity can matter in relationships with artificial companions. It motivates Duck's question of how continuity between conversations affects a user's experience of the character.

**Zhao and Bowman, [“He will always love me”: Authentic romance and reciprocal love in otome games](https://doi.org/10.1177/14614448261434521) (2026).** Their analysis of player responses identifies companionship and integration into daily life among several themes. These accounts provide context for studying recurring contact with a digital companion.

Duck's [`keepalive.js`](../src/services/keepalive.js) implements scheduled background activity when `ENABLE_BACKGROUND_JOBS=true`. The design question is whether later contact feels connected to earlier exchanges, and when it becomes intrusive.

## Conversational performance

**Zeng et al., [LPM 1.0: Video-based Character Performance Model](https://arxiv.org/abs/2604.07823v2) (2026, v2).** LPM treats listening and speaking as parts of sustained audiovisual character performance. In Duck, the design focus is the character's behaviour while listening and replying.

Duck coordinates authored Live2D controls with speech to maintain continuity across a turn. Implementation details are in [Character controls](CHARACTER.md); proposed comparisons are in [Evaluation notes](EVALUATION.md).

## Further design questions

**Learning preferences.** Maroto-Gómez et al., [An adaptive decision-making system supported on user preference predictions for human–robot interactive communication](https://doi.org/10.1007/s11257-022-09321-2) (2023), study predicting a user's activity preferences to guide robot choices. This work informs a future direction for Duck: adapting interaction to the user's preferences.

**Relationship scoring.** Ge and Hu, [Gamifying intimacy: AI-driven affective engagement and human-virtual human relationships](https://doi.org/10.1177/01634437251337239) (2025), examine gamified intimacy in XingYe through autoethnographic analysis. Their account prompts scrutiny of Duck's own relationship scores: what behaviours do those scores encourage, and do they represent meaningful responsiveness?

**Emergent narrative.** Lessard and Paré-Chouinard, [Dramatic Situations for Emergent Narrative System Authorship](https://www.lablablab.net/papers/ICIDS_Lessard_Situations.pdf) (2022), describe authoring dramatic situations within a simulation. This suggests future work on structured situations and consequences in Duck's conversations.

**Levels of experience.** Norman's [Emotional Design: People and Things](https://jnd.org/emotional-design-people-and-things/) offers a lens on initial appearance, use and reflective meaning. In Duck, choosing character settings involves interaction and reflection; reviewing personality changes could offer another opportunity to reflect on the relationship.
