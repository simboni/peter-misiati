# Play Store listing assets

Ready-to-upload graphics for the Google Play listing. All dimensions meet Play's
requirements. Regenerate with `scratchpad/gen-assets.mjs` if you tweak the copy.

| File | Size | Where it goes in Play Console |
| --- | --- | --- |
| `feature-graphic.png` | 1024×500 | Store listing → **Feature graphic** (required) |
| `screen-1-home.png` | 1080×2340 | Store listing → **Phone screenshots** |
| `screen-2-invoice.png` | 1080×2340 | Phone screenshots |
| `screen-3-mpesa.png` | 1080×2340 | Phone screenshots |
| `screen-4-receipt.png` | 1080×2340 | Phone screenshots |

Play needs **2–8 phone screenshots**; these four are enough to publish. Upload in
this order — home first tells the story best.

The **app icon** (512×512, also required) is the launcher icon already in
`mobile/` / `public/icons/icon-512.png`.

> These are marketing mockups built to match the app's real design (emerald
> brand, native chrome, KES/VAT/KRA content). You can also capture real device
> screenshots from the installed debug APK and swap them in — either is fine for
> Play. Sample data only; no real customer information.
