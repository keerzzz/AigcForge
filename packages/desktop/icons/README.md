# AIGCFORGE desktop icons

Scheme 04 geometry is owned by `packages/ui/src/assets/brand/geometry.ts` and shared with `Mark`/`Splash`. Static SVG, Web assets, and all three desktop channels are generated with:

```sh
bun packages/ui/script/generate-brand-assets.ts
```

Run from the repository root with ImageMagick `convert` and Python 3/Pillow installed. No package install is performed by the script. PNGs are rasterized at 4× and reduced for antialiasing. ICO contains 16/20/24/32/48/64/128/256px frames. Pillow writes ICNS from the 32/64/128/256/512/1024px PNGs. Small frames use compact geometry (≤24px), standard geometry (32/48px), and the complete mark at larger sizes.

Static colors resolve the default v2 avatar blue/cyan, text-base, and text-contrast tokens. The C base mixes cyan 55% with text-contrast 45% in sRGB. All channels use the same approved brand; channel identity remains in package metadata.

`copy-icons.ts` copies the selected channel into generated `resources/icons`. Electron uses `icon.png` on Linux, `icon.ico` on Windows, and `dock.png` for the macOS development Dock. Packaged macOS uses `icon.icns`. The 100×100 source canvas supplies the inset; Dock and ICNS 256px entries share identical pixels.

Android/iOS directories retain historical assets until those targets are implemented. Format decoding is checked locally; macOS/Windows package appearance and OS icon caching require target-platform acceptance. Previously installed packages and their system icons are separate from the current source checkout.
