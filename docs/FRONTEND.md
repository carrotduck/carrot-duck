# Frontend files

The homepage serves the application's Home, Chat, Performance, Diary and Settings interface. Local accounts use the same-origin backend. No hosted account records, private memories or provider credentials are included.

| Files | Editing and use |
| --- | --- |
| `public/assets/index-BxtniLRm.js` and `index-TpItDqpy.css` | Compiled JavaScript and CSS from the project deployment. The original component project and build configuration have not been recovered, so this release cannot rebuild this bundle from component source. |
| `public/carrot-duck-performance-page.js` | Editable Performance view and conversation integration. |
| `public/carrot-duck-motion.js`, `carrot-duck-performance.js` and `live2d-demo.html` | Editable character rendering, gestures and playback coordination. |
| `public/autonomous.*` | Editable memory-grounded dialogue and plan inspection interface. |
| `public/local-demo.html` and `demo-login.js` | Minimal account creation/recovery helper for the autonomous walkthrough. |
| `public/live2d/fox/` | Model-loading instructions; supply your own licensed assets locally. |

Run `npm start` from the repository root. There is no separate frontend build step for the bundled interface. Browser libraries for the character stage load from upstream CDNs. User-uploaded media and stickers are not bundled. The root page does not load the rehearsal-control overlay.
