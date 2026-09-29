# CARROT DUCK

A web-based AI companion prototype for studying perceived personal recognition.

I developed CARROT DUCK to explore when an AI companion's recollection feels personally meaningful, and when it feels intrusive. Earlier conversations inform replies expressed through chat and a Live2D character. A configurable personality and an experimental relationship model guide how the companion engages with the user.

[Project website](https://shiruifu.online/projects/carrot-duck/) · [Developer demonstration on YouTube](https://youtu.be/8uiZaVtBBH4)

This repository is a runnable research prototype, with backend source, the web interface, editable performance controllers and character-loading support. Follow the setup instructions below to run it with your own provider credentials. The full hosted application is at [carrotduck.online](https://carrotduck.online/); its accounts and data are separate from a local installation.

Start with the video below. [From the video to the current prototype](docs/DEMO.md#from-the-video-to-the-current-prototype) connects the recorded exchange to steps you can run locally and questions for a future study. The [system notes](docs/AGENT_SYSTEMS.md) explain personality adaptation, affective confidence and relationship policies.

## Demonstration

<a href="https://youtu.be/8uiZaVtBBH4"><img src="docs/images/watch-youtube.svg" alt="▶ Watch on YouTube" width="183" height="36"></a>

[![CARROT DUCK — character and conversation in the hosted Performance interface](docs/images/performance.jpg)](https://youtu.be/8uiZaVtBBH4)

Cover: the hosted Performance interface. Click the image to watch the developer demonstration.

**[Watch the developer demonstration on YouTube](https://youtu.be/8uiZaVtBBH4).** In this prepared sequence, Duck recalls an earlier encounter with a cat and uses its fox ears as part of a playful response. The recording shows the deployed interface; the autonomous mode in this repository was added later. [Demo notes](docs/DEMO.md) include a second frame and explain what the recording demonstrates.

### Interface gallery

| Home | Chat | Performance |
| --- | --- | --- |
| [![Home page with calendar and optional reminders](docs/images/home.jpg)](docs/images/home.jpg) | [![Chat page with the sticker picker open](docs/images/chat.jpg)](docs/images/chat.jpg) | [![Performance page with Duck listening beside the conversation](docs/images/performance.jpg)](docs/images/performance.jpg) |

Screenshots supplied by the developer from the hosted application. Click a frame to view it at full size. The repository includes this web interface as a compiled build, alongside editable character and autonomous interaction scripts. See [Frontend files](docs/FRONTEND.md) for the source/build distinction.

## What is in this repository

The source includes the dialogue service, memory retrieval, relationship and boundary policies, and character performance controller. Research services record candidate moments of perceived personal recognition (PPR) for examination alongside the user's response. These records support analysis; a system-assigned label does not establish that a user felt recognized.

| Part of the project | Role and release scope |
| --- | --- |
| Personality adaptation | Configurable character traits undergo bounded, rule-based changes in the original chat route. The local autonomous demo reads the existing settings without updating them. |
| Affect and uncertainty | Text cues inform an appraisal state and an affective signal with evidence and a heuristic confidence score. These scores have not been calibrated as probabilities of correct emotion recognition. |
| Memory and provenance | Stored details carry source and confidence metadata. Autonomous retrieval selects eligible records and checks the reply's cited IDs. |
| Relationship and boundaries | The wider dialogue services track familiarity, explicit relationship cues and decaying boundary pressure to guide later responses. |
| Expression within a turn | The performance controller coordinates a reply with a supported gesture, facial expression and optional voice. This is the character layer used to present the interaction. |
| Research records | Candidate recognition events and subsequent reaction labels support review in the wider prototype. The local autonomous route keeps its own retrieval and playback traces. |

[Agent systems and research questions](docs/AGENT_SYSTEMS.md) explains how these mechanisms are implemented, which routes use them, and what remains to be evaluated.

The homepage opens the full application. The Autonomous link opens a separate interaction mode. It retrieves eligible memories from the current account, generates a reply and a bounded performance plan, and shows the records cited by the model. The plan combines a gesture with a facial expression and an optional change to the character's ears. Browser playback reports can inform the next turn. Daily conversation uses smaller movements than the performance setting.

For each autonomous reply, a reviewer can compare the cited memory with the generated wording and selected gesture. This helps identify a correct recollection presented awkwardly, or an expressive reply that misreads its source. See [Architecture](docs/ARCHITECTURE.md) for the autonomous path and the wider research services.

## Duck as the character example

Duck combines head turns, gaze shifts, nods and body movement with hand poses, a cheek-rest pose, ear visibility and blush. The rig also contains a held lantern and a flame control, plus a darkened-face expression for an angry-looking response. The stage exposes eight native motion clips and eight expression presets; the authored controller adds 15 parameter gestures. The autonomous planner currently selects from 11 of those gestures. These layers and their controls are listed in [Character capabilities](docs/CHARACTER.md). In voiced turns, the main gesture starts with audio playback and releases when the turn ends or is interrupted.

| Interaction | Current autonomous behavior |
| --- | --- |
| A reply draws on a saved memory | The reply includes source IDs; a remembered smile is available when the plan cites a memory. |
| The exchange calls for comfort | The plan can select a concerned expression and use a lower movement intensity. |
| A playful invitation fits the exchange | The controller can reveal the ears or offer a head-pat pose, subject to the plan's invitation and boundary checks. |
| The user declines | The plan switches to a restrained listening response and hides the ears. |

These are supported behaviors, not a fixed script for every matching utterance. Another Live2D model needs compatible controls or adjusted mappings. A future 3D version could explore full-body posture, spatial orientation and reaching toward objects, but would require a new animation adapter and scene interaction logic. No 3D implementation is included. [Character capabilities and extension notes](docs/CHARACTER.md) describe this boundary.

## Autonomous interaction flow

```mermaid
flowchart TD
  U[User message] --> R[Account-scoped memory retrieval]
  M[(Eligible saved memories)] --> R
  R --> G[Generate reply and performance plan]
  A[Affect and boundary hypotheses] --> G
  G --> T[Text reply and cited records]
  G --> B[Bound gesture and expression to the interaction mode]
  B --> P[Optional Live2D character and voice]
  P --> F[Browser playback report]
  F -. Informs the next turn .-> G
```

The diagram shows the autonomous path exposed by the local interface. Memories enter this path through the explicit save form. Playback reports describe browser execution; they do not measure the user's reaction.

## Run locally

Use Node.js 24 or newer and npm.

```sh
git clone https://github.com/carrotduck/carrot-duck.git
cd carrot-duck
npm ci
```

Copy `.env.example` to `.env`, add your own `DEEPSEEK_API_KEY`, then run:

```sh
npm start
```

Open <http://127.0.0.1:3002> to set up a local account and use Home, Chat, Performance, Diary and Settings. For an inspectable memory test, open [the local account helper](http://127.0.0.1:3002/local-demo.html) and continue to autonomous interaction. Save an invented experience with the memory form, then ask a related question. Open the inspect panel to compare the reply with its cited source and selected performance.

Keep the server running while using that address: `127.0.0.1` refers to your own computer. On Windows, `start-local.cmd` starts it after installation and configuration. A “connection refused” message usually means the server has not started or has stopped.

Model files are not included. Supply a licensed Live2D model using the [loading instructions](public/live2d/fox/README.md); speech requires your own voice credentials. The account, conversations and memories belong to this local installation.

| Experience | What you need |
| --- | --- |
| Text replies, memory retrieval and plan inspection | Node.js, installed dependencies and a valid DeepSeek API key |
| Animated character | Your own licensed model and internet access for the rendering runtime; check its parameter mappings |
| Spoken replies | An ElevenLabs API key and voice ID |

Loading another model does not guarantee every gesture or expression will work. Standard head, eye and mouth controls are used where available; custom controls such as ears and blush need model-specific mappings. This release does not automatically adapt the action library to a new model.

## Tests

```sh
npm test
```

Tests use synthetic fixtures and temporary databases. They cover memory boundaries, account isolation, reply planning, playback cancellation and prepared scenes. They do not require provider keys. Passing these tests checks software behavior, not PPR outcomes or perceived naturalness.

## Current limitations

Retrieval and generation can misinterpret a memory. Source IDs help trace a response but do not verify its meaning. The character controller depends on the parameters available in each model; this version plans one main gesture per turn and does not support arbitrary objects or physical robot movement. The autonomous page saves new long-term memories only through its explicit memory form.

The project is implemented in JavaScript with Node.js, Express, SQLite and Live2D.

## License and attribution

Original code and documentation are available under the [MIT License](LICENSE). Third-party dependencies and artwork depicted in screenshots have their own terms; see [Third-party notices](THIRD_PARTY_NOTICES.md). Conversation databases, private memory records and provider credentials are excluded. Third-party model files are excluded; screenshots do not grant rights to reuse the depicted artwork.

Project by [Shirui Fu](https://shiruifu.online/). Citation metadata is in [CITATION.cff](CITATION.cff).
