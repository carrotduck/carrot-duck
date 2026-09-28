# Third-party components

The MIT license in this repository covers original CARROT DUCK code and documentation. It does not relicense dependencies, provider services, third-party models or artwork.

Node dependencies are listed in `package.json` and resolved in `package-lock.json`. Their licenses are distributed with the respective packages. The browser renderer references PixiJS, pixi-live2d-display and the Live2D Cubism Core runtime; users must follow their applicable licenses and runtime terms.

The Live2D model files, textures, motion files, user stickers and uploaded media are excluded. Supply assets you are permitted to use. The demonstration model's original author and distribution license have not yet been recovered, so it is not bundled or assigned this project's MIT license.

The two documentation screenshots in `docs/images/` are frames from Shirui Fu's developer demonstration. They contain third-party character artwork and are not offered under the repository's MIT license. Including these screenshots or linking to the video does not grant rights to extract or reuse its character assets or audio. See [image provenance](docs/images/README.md).

DeepSeek, ElevenLabs and the optional embedding/search services are external providers. Configure your own credentials and follow their service terms. No voice recording, cloned voice or private voice identifier is supplied.

Architectural references are listed in [Architecture](docs/ARCHITECTURE.md). The documentation edit also consulted [Academic Humanizer](https://github.com/AIScientists-Dev/academic-humanizer/blob/main/SKILL.md) for clarity and claim-evidence alignment; the skill is not bundled or installed by this project.
