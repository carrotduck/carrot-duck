# Third-party components

The MIT license in this repository covers original CARROT DUCK code and documentation. It does not relicense dependencies, provider services, third-party models or artwork.

Node dependencies are listed in `package.json` and resolved in `package-lock.json`. Their licenses are distributed with the respective packages. The browser renderer references PixiJS, pixi-live2d-display and the Live2D Cubism Core runtime; users must follow their applicable licenses and runtime terms.

The compiled application bundle includes React and React DOM 19.2.7. Their upstream MIT notice is preserved in [React-LICENSE.txt](public/assets/licenses/React-LICENSE.txt).

Third-party model files are excluded from the current repository. Users must supply models they are licensed to use; see the [loading instructions](public/live2d/fox/README.md). User stickers and uploaded media are also excluded.

The documentation screenshots in `docs/images/` include frames from Shirui Fu's developer demonstration and interface captures supplied by the developer. They depict third-party character or sticker artwork and are not offered under the repository's MIT license. Including these screenshots or linking to the video does not grant rights to extract or reuse its artwork, character assets or audio. See [image provenance](docs/images/README.md).

DeepSeek, ElevenLabs and the optional embedding/search services are external providers. Configure your own credentials and follow their service terms. No voice recording, cloned voice or private voice identifier is supplied.

Architectural references are listed in [Architecture](docs/ARCHITECTURE.md).
