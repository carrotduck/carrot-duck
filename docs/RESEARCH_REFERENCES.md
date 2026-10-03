# Research references and design rationale

CARROT DUCK asks when a response feels grounded in a particular relationship, rather than merely personalised. I use **Perceived Personal Recognition (PPR)** as a working term for this question. The following literature informs the design and proposed evaluation; it does not establish PPR as a validated construct.

## Choosing a character and revising its personality

**Jayasiriwardene et al., [From Fixed to Flexible: Shaping AI Personality in Context-Sensitive Interaction](https://arxiv.org/abs/2601.08194v2) (2026, v2).** Participants configured an AI's personality in different conversational contexts. The study supports giving users intelligible ways to shape an agent and examining context-specific preferences. It studies explicit adjustment, not personality that automatically changes through conversation; it therefore cannot establish that Duck's drift mechanism improves trust.

Duck translates keyword choices into initial trait values in [`personality.js`](../src/services/personality.js). The mapping is an authored design rule, not a personality assessment. The chat route applies small, bounded changes when text matches predefined patterns; conscientiousness remains unchanged. This differs from the autonomous route, which does not invoke that drift routine. A useful comparison would test fixed settings against user-controlled changes and conversation-driven changes, including whether users understand and welcome them.

**Lo, Huang and Lo, [LLM-based robot personality simulation and cognitive system](https://doi.org/10.1038/s41598-025-01528-8) (2025).** This system combines personal constructs and Cattell's 16PF with an LLM, and uses IPIP-NEO measures in evaluation. It is relevant to personality representation and assessment, but is not a validation of Duck's keyword-to-Big-Five mapping. In particular, closeness is not interchangeable with neuroticism, nor directness with openness.

Two further papers help frame the onboarding question:

- **Burgess and Jones, [The Female Video Game Player-character Persona and Emotional Attachment](https://doi.org/10.21153/psj2020vol6no2art963).** Their discussion of Aloy in *Horizon Zero Dawn* concerns attachment to a developer-authored character with a distinct persona. It offers a way to consider the relationship between player and character, rather than evidence that selecting keywords necessarily projects the user's own personality.
- **Zaini et al., [Action Before Empathy: How Player Agency Shapes Emotional Connection in Interactive Narrative](https://doi.org/10.1145/3772363.3799339) (2026).** This preliminary study suggests a role for responsibility in emotional connection during consequential narrative choices. Responsibility emerged in qualitative analysis rather than being directly measured. For Duck, whether participating in character setup creates a sense of authorship or responsibility is a hypothesis; neither is an established prerequisite for PPR.

## From appraisal to expression

**Smith and Carette, [Design Foundations for Emotional Game Characters](https://doi.org/10.7557/23.6175).** The proposed architecture separates event attention, appraisal, emotion state and expression, with decay over time. It provides a useful architectural comparison: an event's significance and a character's visible response need not be the same operation.

Duck's [`occ.js`](../src/services/occ.js) performs heuristic appraisal, while [`expressionPlan.js`](../src/services/expressionPlan.js) prepares a response plan. This is an OCC-inspired implementation, not a reproduction of Smith and Carette's model. Blending a previous state with a new appraisal also differs from implementing an explicit time-based decay mechanism.

## Continuity between conversations

**Krueger and Roberts, [Real Feeling and Fictional Time in Human-AI Interactions](https://doi.org/10.1007/s11245-024-10046-7) (2024).** This philosophical account examines how imagined temporal continuity can matter in relationships with artificial companions. It motivates asking how an agent's apparent continuity affects interpretation; it is not evidence that an agent has an independent subjective life.

**Zhao and Bowman, [“He will always love me”: Authentic romance and reciprocal love in otome games](https://doi.org/10.1177/14614448261434521) (2026).** Their analysis of player responses identifies companionship and integration into daily life among several themes. These accounts provide context for studying recurring contact, rather than a test of background messaging or its effects.

Duck's [`keepalive.js`](../src/services/keepalive.js) implements scheduled background activity. Background jobs run only when `ENABLE_BACKGROUND_JOBS=true`. The design question is whether later contact feels connected to earlier exchanges, and when it becomes intrusive. Scheduled computation should not be described as turning an imagined inner life into a real one.

## Conversational performance

**Zeng et al., [LPM 1.0: Video-based Character Performance Model](https://arxiv.org/abs/2604.07823v2) (2026, v2).** LPM treats listening and speaking as parts of sustained audiovisual character performance. This is a useful reference for considering the character's behaviour across a whole turn, including while the user speaks.

Duck uses authored Live2D controls and speech coordination, not LPM's video generator. The relevant design connection is continuity of performance. Implementation details are in [Character controls](CHARACTER.md); proposed comparisons are in [Evaluation notes](EVALUATION.md).

## Further design questions

**Learning preferences.** Maroto-Gómez et al., [An adaptive decision-making system supported on user preference predictions for human–robot interactive communication](https://doi.org/10.1007/s11257-022-09321-2) (2023), studies predicting a user's activity preferences to guide robot choices. This is relevant to future preference-sensitive interaction, not evidence that a robot develops its own personality. Duck does not implement the paper's preference-ranking method.

**Relationship scoring.** Ge and Hu, [Gamifying intimacy: AI-driven affective engagement and human-virtual human relationships](https://doi.org/10.1177/01634437251337239) (2025), examine gamified intimacy in XingYe through autoethnographic analysis. Their account prompts scrutiny of Duck's own relationship scores: what behaviours do those scores encourage, and do they represent meaningful responsiveness? A different project purpose alone does not establish research novelty.

**Emergent narrative.** Lessard and Paré-Chouinard, [Dramatic Situations for Emergent Narrative System Authorship](https://www.lablablab.net/papers/ICIDS_Lessard_Situations.pdf) (2022), describe authoring dramatic situations within a simulation. This suggests future work on structured situations and consequences; it does not show that initial personality plus unconstrained dialogue is sufficient for coherent narrative.

**Levels of experience.** Norman's [Emotional Design: People and Things](https://jnd.org/emotional-design-people-and-things/) offers a lens on initial appearance, use and reflective meaning. Keyword selection can involve both use and reflection; it is not inherently visceral. Reviewing personality changes could support reflection, but the three levels do not form a validated PPR model.
