# Green folder icon
Generated with the built-in image_gen tool using the existing build/icon.png as the edit target. Original purple assets remain available.

Prompt:
Edit this desktop application folder icon for a fork named CardMirror Green. Change the purple folder surfaces to unmistakable rich emerald green, with mint green highlights and darker forest-green shading. Preserve the recognizable open-folder silhouette, rounded corners, smooth glossy dimensional style, front panel and rear folder tab. Keep centered with generous safe margin on a square canvas; entire folder visible, no clipping. No text, letters, extra symbols, or watermark. Remove the white background and output genuine transparent alpha. This is a production desktop app icon, legible at small sizes.

The generated RGBA asset was resized and converted to green.png, green.ico and green.icns with Pillow. Renderer favicons and the draggable file mark use resized copies of the same generated asset.

## Document association icons

`green-cmir.icns/.ico` and `green-docx.icns/.ico` reuse the original procedural folded-page design with `green.png` as the centered mark. Regenerate on a machine with Pillow using `python3 apps/desktop/scripts/generate-doc-icons.py --green` from the repo root. The generator writes ICNS with Pillow, so it works without Apple's iconutil. Purple assets remain separate.
