# CARROT DUCK

A conversational companion exploring how remembered experiences shape interaction with a virtual character.

I developed CARROT DUCK to investigate when recalling an earlier conversation feels attentive, and when it feels intrusive. The companion draws on saved context to reply through chat and Live2D performance. My work connects memory retrieval to the character's expression and the timing of its response.

[Watch the demonstration](https://youtu.be/8uiZaVtBBH4) · [Open the live companion](https://carrotduck.online/) · [Project website](https://shiruifu.online/projects/carrot-duck/)

## Demonstration

[![Duck speaking in the Performance interface](docs/images/performance.jpg)](https://youtu.be/8uiZaVtBBH4)

Duck recalls that petting a cat helped the user feel better, then reveals its fox ears as part of a playful response. The example connects a remembered experience to something the character can express. [Demo notes](docs/DEMO.md) describe the exchange.

### Interface gallery

| Home | Chat | Performance |
| --- | --- | --- |
| [![Home page](docs/images/home.jpg)](docs/images/home.jpg) | [![Chat page](docs/images/chat.jpg)](docs/images/chat.jpg) | [![Performance page](docs/images/performance.jpg)](docs/images/performance.jpg) |

## How the interaction works

The dialogue service uses conversation history and saved memories to prepare a response. Character settings and relationship rules influence how it addresses the user. During a voiced turn, the character's main gesture begins with speech and returns toward neutral when playback ends or is interrupted.

The Autonomous interface makes one interaction path inspectable. A user saves a memory, asks a related question, and can examine the retrieved records alongside the generated reply and chosen gesture. For example, a recalled experience may accompany a smile; an explicit refusal leads to a more restrained response. The planner selects from a defined action library, with one main gesture per turn.

This makes it possible to examine how the same remembered detail is expressed. A response can recall something accurately yet still feel awkward or unwelcome. The proposed evaluation asks how wording and character expression affect that experience.

## Explore the implementation

| Guide | What it covers |
| --- | --- |
| [Autonomous walkthrough](docs/AUTONOMOUS_WALKTHROUGH.md) | Try a recollection and a refusal, then inspect the response. |
| [Architecture](docs/ARCHITECTURE.md) | Follow a message through retrieval, generation and playback. |
| [Agent systems](docs/AGENT_SYSTEMS.md) | See how personality and relationship rules work across the dialogue routes. |
| [Character controls](docs/CHARACTER.md) | Inspect the gestures and their Live2D parameter mappings. |
| [Evaluation notes](docs/EVALUATION.md) | Read the proposed comparisons and measures of user experience. |

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

Keep the server running while using the local address. On Windows, `start-local.cmd` starts it after setup. See [Running and configuration](docs/RUNNING.md) for troubleshooting.

Model files are not included. Supply a licensed Live2D model using the [loading instructions](public/live2d/fox/README.md); speech requires your own voice credentials. The account, conversations and memories belong to this local installation.

| Experience | What you need |
| --- | --- |
| Text replies, memory retrieval and plan inspection | Node.js, installed dependencies and a valid DeepSeek API key |
| Animated character | Your own licensed model and internet access for the rendering runtime; check its parameter mappings |
| Spoken replies | An ElevenLabs API key and voice ID |

Adapt the gesture mappings to your model, particularly custom controls such as ears and blush. The bundled application interface is a compiled build; editable controllers and backend source are included. See [Frontend files](docs/FRONTEND.md) for details.

## Tests

```sh
npm test
```

Tests use synthetic fixtures and temporary databases. They cover memory boundaries, account isolation, reply planning, playback cancellation and prepared scenes. They do not require provider keys. 

## Current limitations

Retrieval and generation can misinterpret a memory. Source IDs help trace a response but do not verify its meaning. The autonomous page saves new long-term memories only through its explicit memory form.

The project is implemented in JavaScript with Node.js, Express, SQLite and Live2D.

## License and attribution

Original code and documentation are available under the [MIT License](LICENSE). Third-party dependencies and artwork depicted in screenshots have their own terms; see [Third-party notices](THIRD_PARTY_NOTICES.md). Conversation databases, private memory records and provider credentials are excluded. Third-party model files are excluded; screenshots do not grant rights to reuse the depicted artwork.

Project by [Shirui Fu](https://shiruifu.online/). Citation metadata is in [CITATION.cff](CITATION.cff).
