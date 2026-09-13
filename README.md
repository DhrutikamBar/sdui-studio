# SDUI Studio

SDUI Studio is an internal admin portal for creating, previewing, versioning, and publishing Server-Driven UI documents.

## First MVP capabilities

- Screen directory with draft and published versions
- Form-led properties plus an advanced JSON editor
- Approved data-binding picker and sample response panel
- Mobile-shaped preview
- Draft, publish, and rollback interactions
- Local-first storage model ready to be replaced by a Firestore adapter

## Safety model

Studio manages layouts and approved binding paths only. It does not store API credentials or permit arbitrary API endpoint calls. A production publish endpoint must validate schema, roles, capabilities, and action policies before writing a published screen document.

## Run locally

```bash
npm install
npm run dev
```
