# SDUI Studio

SDUI Studio is an internal admin portal for creating, previewing, versioning, and publishing Server-Driven UI documents.

It also contains a focused **Figma-to-SDUI exporter**: a local Figma development plugin that converts a selected design frame into a reviewable SDUI JSON starting point.

## First MVP capabilities

- Screen directory with draft and published versions
- Form-led properties plus an advanced JSON editor
- Approved data-binding picker and sample response panel
- Mobile-shaped preview
- Draft, publish, and rollback interactions
- Local-first storage model ready to be replaced by a Firestore adapter
- Selected-frame Figma export with conversion notes

## Figma exporter

The exporter intentionally produces a safe starting document rather than claiming perfect, arbitrary Figma reproduction. It maps Auto Layout to SDUI rows/columns, text to SDUI text, and recognises the conventions below:

| Figma layer name | Result |
| --- | --- |
| `sdui:button` | SDUI button |
| `route:wallet` in a button name | Navigate action to `wallet` |
| `bind:user.name` on a text layer | `{{user.name}}` data binding |
| `sdui:repeater:transactions` | Repeater bound to `{{transactions}}` |
| Vertical / horizontal Auto Layout | Column / row |

Unsupported vectors, images, and gradient fills are reported as conversion notes so a designer or developer can make an explicit resource decision.

### Install the Figma plugin locally

```bash
npm install
npm run build:plugin
```

In the Figma desktop app:

1. Open **Plugins → Development → Import plugin from manifest…**
2. Select `figma-plugin/manifest.json` from this repository.
3. Select one frame, component, or group.
4. Run **SDUI Figma Exporter**, choose **Convert selection**, review the notes, then copy the JSON into Studio.

## Safety model

Studio manages layouts and approved binding paths only. It does not store API credentials or permit arbitrary API endpoint calls. A production publish endpoint must validate schema, roles, capabilities, and action policies before writing a published screen document.

## Run the Studio locally

```bash
npm install
npm run dev
```

Then open the localhost link shown in the terminal.
