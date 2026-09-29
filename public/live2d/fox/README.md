# Load a licensed Live2D model

Model files are not distributed with this repository. Supply a Cubism 4-compatible model you are licensed to use.

1. Place the model manifest, .moc3 file, textures, physics, expressions and motions in a local folder under `public/live2d/`, preserving the package's relative paths.
2. Set `LIVE2D_MODEL_PATH` in `.env`, for example `/live2d/my-model/my-model.model3.json`.
3. Restart the service, then open Performance or the autonomous interaction page.
4. Review the parameter mappings in `public/carrot-duck-motion.js` before enabling custom gestures. Ear and blush controls are specific to the demonstration rig.

Local model assets are ignored by Git. Text interaction and plan inspection can be used without a model. See [Running and configuration](../../../docs/RUNNING.md) for setup and runtime requirements.

The project's MIT license covers original code and documentation, not third-party character assets or artwork shown in screenshots.
