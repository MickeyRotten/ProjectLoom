# Bundled fonts

Both faces back Settings → Appearance → Font. They are vendored here rather than
linked from Google Fonts because the packaged APK plays offline — a webfont
fetched over the network would never arrive there.

Each is shipped as the `latin` + `latin-ext` woff2 subsets Google Fonts serves;
character and location names are player-authored, so accented Latin is ordinary
input here. Anything outside both subsets falls through to the platform
monospace stack (`theme.css`).

| File | Family | Source |
| --- | --- | --- |
| `vt323-latin.woff2`, `vt323-latin-ext.woff2` | VT323 (Peter Hull) | https://fonts.google.com/specimen/VT323 |
| `jersey15-latin.woff2`, `jersey15-latin-ext.woff2` | Jersey 15 (Sarah Cadigan-Fried) | https://fonts.google.com/specimen/Jersey+15 |

Both are licensed under the **SIL Open Font License 1.1**
(https://openfontlicense.org), which permits bundling and redistribution with an
application. Full license text ships with each family on Google Fonts.
