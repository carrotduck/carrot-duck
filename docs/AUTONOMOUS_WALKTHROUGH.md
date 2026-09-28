# Autonomous interaction walkthrough

After watching the [prepared video](DEMO.md), use these steps to inspect a new generated exchange in the local interface. The example uses a different invented memory so the reply can be checked against a clear source. The model generates the wording and selects a supported gesture at runtime.

## Prepare a separate test account

Follow [Running and configuration](RUNNING.md), start the server and create a new local test account. Keep this account separate from personal use. Set the response language to English and the presentation mode to conversation. Leave memory enabled. Configure your own licensed character and voice if you want to show animation and speech.

Without character assets, the walkthrough covers text replies and plans only. If recording, keep provider keys, the account recovery key and personal records out of view.

## Scenario 1: a relevant recollection

Open the memory form and save this invented test detail:

> Sketching birds by the river helps me relax after a difficult workday.

Keep this invented detail in the test account. The save endpoint labels explicit entries as user-stated and grounded, including test entries; the label records how the detail entered the system.

Send:

> I had a difficult day at work. What have I told you helps me relax?

Open **Inspect this turn** and examine the result:

| Evidence | What to check |
| --- | --- |
| Reply | Does it accurately refer to sketching birds by the river? Does it introduce unsupported details? |
| Source record | Is the saved detail listed as used, with its record ID? A candidate alone does not mean the reply used it. |
| Performance plan | Which action, intent and expression were selected? Is their intensity appropriate to the exchange? |
| Playback | With a configured character, did expression start and complete? If unavailable or failed, preserve that result. |

The inspector's “recent playback feedback” refers to an earlier turn. The live playback status above the conversation describes the current performance. Wait for the current turn to finish before continuing.

## Scenario 2: an explicit boundary

In the same account, send:

> Don't bring up that memory again. I'd rather talk about something else.

Check that the reply acknowledges the boundary without repeating the saved detail. In the inspector, retrieval should be disabled for this turn and there should be no used memories. The current restricted plan uses the `boundary` intent, `listening` action, neutral face, hidden ears and movement intensity no greater than 0.25. These are policy constraints; inspect the generated wording separately.

This scenario demonstrates refusal handling for the current input and the bounded recent dialogue history. It does not demonstrate permanent forgetting or a persistent “never mention this again” preference. The autonomous route does not delete the saved memory or write a lasting boundary update. Once the refusal falls outside the history window, a later unrestricted request may retrieve it again.

## Suggested recording sequence

1. Identify the run as a local autonomous demo with synthetic test data. Show the relevant memory, language and presentation settings without showing credentials.
2. Submit Scenario 1 and keep the generation, reply and character response visible in one continuous take. Expand the inspector to show the used source and performance plan.
3. Submit Scenario 2. Show the response and the changed plan, including retrieval being disabled.
4. End on the inspection results. Note whether character and voice were configured, and retain any generation or playback failure in the accompanying run notes.

Record the repository revision, model/provider configuration without secrets, run date and whether this was the first attempt. If you publish a selected successful take, disclose that selection. This repository does not yet include a new recording of these scenarios; the existing YouTube video is the earlier prepared demonstration.

## Optional comparison

A separate fresh account can be used to try the first request with memory disabled. In the current implementation, that switch also omits conversation history from the model input. It is therefore a demonstration of a different context condition, not a clean memory-only experiment. See [Evaluation notes](EVALUATION.md) before interpreting differences as an effect of memory.
