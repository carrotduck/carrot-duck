# Character capabilities and extension notes

CARROT DUCK is a web-based companion research prototype. Its central question concerns perceived personal recognition: how a response draws on an earlier exchange, and how the user experiences that reference. The character provides one way to present the response. Changing its visual form would change the available gestures, but would not by itself answer the research question.

## Current Live2D example

The fox-eared character called Duck is the model used in the developer demonstration. CARROT DUCK supplies the dialogue and memory services, performance planning and playback coordination. The character artwork and rig are third-party assets.

The motion controller writes bounded values to the model's head, body, eye and mouth controls. It blends gestures with idle movement and returns toward neutral after release. Ear visibility and blush use controls specific to this rig. The autonomous planner selects one main gesture per turn, with a facial expression and an ear setting; it does not compose arbitrary sequences of body actions.

The system tracks interaction state through browser reports. Preparation, speech and character playback have explicit states, and the selected conversation or performance mode limits movement intensity. This lets the next turn use execution feedback, such as a cancelled performance. It does not establish subjective awareness or perception of the user's surroundings.

| Behavior | Available in this implementation | Dependency or limit |
| --- | --- | --- |
| Listening, nodding and gaze shifts | Authored parameter gestures and idle motion | Appearance depends on the rig's controls and ranges. |
| Expression accompanying dialogue | Neutral, warm, concerned and curious facial plans | Text-derived affect is an estimate; expressions are not evidence of correct emotion recognition. |
| Ear reveal and head-pat invitation | Separate ear state and invitation gesture | Requires the appropriate model controls. No physical contact is sensed. |
| Speech coordination | Audio playback starts the main gesture; speech drives mouth movement | Requires configured speech synthesis. Gestures are not scheduled word by word. |
| Playback feedback | Started, completed, failed or cancelled reports | Describes browser execution, not the user's reaction. |
| Arbitrary props and scene actions | Not supported by the autonomous action library | A model's visible accessory does not make it an independently controllable object. |

The [recorded demonstration](DEMO.md) uses a prepared exchange. The autonomous planner was added later and uses account-scoped memories and generated replies. The recording illustrates the presentation design, while the local inspect panel exposes the current planner's decisions.

## What a 3D implementation could add

A 3D character could provide full-body poses and spatially directed gestures. For example, a reply might orient the character toward a chair or accompany an invitation with a reaching motion. These are possible extensions, not features obtained merely by loading a 3D file.

| Extension | Work required |
| --- | --- |
| Full-body posture and movement | A rigged model, animation clips or procedural controls, and blending between states |
| Looking or turning toward a scene target | Target positions, gaze and orientation controls, and a camera/scene setup |
| Reaching for or holding an object | A manipulable scene object, hand targets, inverse kinematics and contact/attachment logic |
| Reusing dialogue and memory services | An adapter translating performance intent into supported 3D actions and reporting playback outcomes |

The current browser renderer is built for Live2D. A 3D renderer would need its own action capabilities and execution layer; the existing parameter writer cannot drive a 3D rig. The proposed adapter would also need cancellation and failure handling so dialogue can continue when an action is unavailable. There is no Unity or Unreal Engine project in this release.

Future evaluation should examine whether these additional movements help users interpret a recalled detail, and when they become distracting or intrusive. More animation controls alone would not demonstrate a more natural interaction.
