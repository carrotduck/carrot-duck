# Running CARROT DUCK

The public release provides a local account page and the autonomous interaction interface. It also includes the backend services used by the wider prototype. The deployed site's compiled front end and purchased character assets are excluded.

## Install and start

Install Node.js 24 or newer, then run `npm ci` in the repository root. `better-sqlite3` is a native dependency. If npm cannot find a binary for your platform, its build step may require a C++ toolchain and Python. The dependency versions are recorded in `package-lock.json`.

Create your local settings file:

```sh
# macOS / Linux
cp .env.example .env
```

```powershell
# Windows PowerShell
Copy-Item .env.example .env
```

Set `DEEPSEEK_API_KEY` in `.env`, then run `npm start`. Open <http://127.0.0.1:3002>. The service binds to the loopback interface by default. Restart it after changing environment settings.

Create a local test account, keep its recovery key private, and follow the link to autonomous interaction. The account is stored in the local SQLite database. It is separate from any account on the hosted CARROT DUCK website.

For a first test, save an invented memory such as “Sketching birds by the river helps me relax after work.” Ask what helps you relax and inspect the cited record. Try an unrelated question to see whether the response avoids an unnecessary memory reference. Generation varies between runs.

The service can start without a model key, and the tests run without one. Autonomous reply generation requires a valid key and incurs the configured provider's charges.

## Character and voice

The default stage explains that the character assets are missing. Replies and performance plans remain available as text. No animation is reported as completed when the stage is unavailable.

To use a model you are licensed to run:

1. Place its model JSON, textures, motions and related files under `public/live2d/`, preserving relative paths.
2. Set `LIVE2D_MODEL_PATH` to a same-origin path such as `/live2d/my-model/my-model.model3.json`.
3. Restart the service and reopen the interaction page.

The renderer expects Cubism 4-compatible assets. It loads the Cubism Core runtime, PixiJS and pixi-live2d-display from their configured upstream URLs. Those requests require internet access and are subject to the respective projects' terms. The purchased fox model is not available through this repository.

Gestures use standard head, body, eye and mouth parameters when present. Ear visibility and blush include mappings specific to the original rig (`Param19` and `Param18`). Adapt these mappings for another model; a different model may not support the same gestures. The parameter writer checks available controls before writing.

For speech, set both `ELEVENLABS_API_KEY` and `ELEVENLABS_VOICE_ID` to values from your own account. Enable the voice checkbox in the interaction page. Voice text is sent to ElevenLabs; playback begins after synthesis. Browser autoplay rules can prevent sound until the page has received a user interaction.

## Optional services and data

Lexical memory retrieval works without embeddings. Configure the `EMBEDDING_*` values to enable the existing embedding path. Other provider adapters are included in the source, but are not needed for the basic autonomous demo.

Data is written to `data/` by default. `DATA_DIR` can point to a separate directory. Use a new directory for experiments; do not substitute an existing deployment database. The repository ignores local databases, uploads, model assets and `.env` files.

Background contact and maintenance jobs are disabled by default. `ENABLE_BACKGROUND_JOBS=true` enables the existing scheduler, which may make additional provider calls. An empty `ADMIN_SECRET_KEY` disables administrative access. If you deliberately expose the service beyond localhost, review authentication, HTTPS, rate limits, provider spending limits and data handling for that deployment.

## Troubleshooting

“Autonomous generation unavailable” can mean the key is missing, the provider request failed, or generated output failed validation. Check the server console and your provider account. The service does not substitute a prepared scene for a failed autonomous generation.

If a saved memory is not recalled, inspect its eligibility and relevance. Autonomous retrieval accepts active, grounded records whose confidence is not low. Turning recall off also omits previous dialogue from the model input as a conservative measure against reusing an earlier callback.

If the character remains unavailable, check `LIVE2D_MODEL_PATH`, the browser network panel and the model's relative asset paths. Text replies can still be inspected while resolving the asset setup.
