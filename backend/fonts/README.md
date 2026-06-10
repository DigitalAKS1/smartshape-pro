# Bundled certificate fonts

Curated fonts for the certificate designer (per-field font choice). All are free
and redistributable (SIL Open Font License or Apache 2.0), fetched from Google Fonts.

| Family | File | License |
|---|---|---|
| Roboto | Roboto-Regular.ttf | Apache 2.0 |
| Open Sans | OpenSans-Regular.ttf | OFL |
| Montserrat | Montserrat-Regular.ttf | OFL |
| Lato | Lato-Regular.ttf | OFL |
| Merriweather | Merriweather-Regular.ttf | OFL |
| Playfair Display | PlayfairDisplay-Regular.ttf | OFL |
| Great Vibes | GreatVibes-Regular.ttf | OFL |
| Dancing Script | DancingScript-Regular.ttf | OFL |

Used by `cert_engine.FONT_REGISTRY`. Pillow renders them for PNG templates;
PyMuPDF embeds them for PDF overlay. "Default" (no file) falls back to the
system font. To add a font: drop the static `.ttf` here and add it to
`FONT_REGISTRY`, and add a matching Google-Fonts `<link>` in the frontend
`TemplateDesigner` for accurate on-canvas preview.
