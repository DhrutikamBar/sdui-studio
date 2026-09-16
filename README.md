# FlexFlow UI

FlexFlow UI is an internal portal for creating, previewing, versioning, and publishing mobile interface documents.

It also includes **FlexFlow UI Exporter**, a local Figma development plugin that converts a selected design frame into a reviewable JSON starting point.

## First MVP capabilities

- Screen directory with draft and published versions
- Form-led properties plus an advanced JSON editor
- Approved data-binding picker and sample response panel
- Mobile-shaped preview
- Draft, publish, and rollback interactions
- Local-first editing with optional shared Firestore drafts and versions
- Selected-frame Figma export with conversion notes

## Figma exporter

The exporter produces a starting document for review. It maps Auto Layout to rows and columns, text layers to text components, and recognises the conventions below:

| Figma layer name | Result |
| --- | --- |
| `flexflow:button` | FlexFlow UI button |
| `route:wallet` in a button name | Navigate action to `wallet` |
| `bind:user.name` on a text layer | `{{user.name}}` data binding |
| `flexflow:repeater:transactions` | Repeater bound to `{{transactions}}` |
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
4. Run **FlexFlow UI Exporter**, choose **Convert selection**, review the notes, then copy the JSON into FlexFlow UI.

## Safety model

Studio manages layouts and approved binding paths only. It does not store API credentials or permit arbitrary API endpoint calls. A production publish endpoint must validate schema, roles, capabilities, and action policies before writing a published screen document.

## Shared Firestore workspace

Studio works locally until a user signs in with an administrator-created email/password account. The top bar then shows one of four clear states: local-only, saving, shared-and-saved, or shared-sync-failed.

The shared data structure is:

```text
screen collection/{screenId}             screen metadata
screen collection/{screenId}/versions/{version} immutable draft or published document
studioUsers/{firebaseUid}                 role record
```

The current collection identifier remains in `lib/studio-store.ts` for compatibility with existing Firestore data. `firestore.rules` is deliberately secure by default. Add each approved Firebase Authentication user to the `studioUsers` collection from the Firebase Console before using FlexFlow UI:

```json
// Document ID: the user's Firebase Authentication UID
{ "role": "admin" }
```

Available roles are:

- `designer`: read, save drafts, and publish versions.
- `reviewer`: read-only access.
- `admin`: designer permissions plus user-role administration and delete/rollback support.

Deploy `firestore.rules` from the Firebase Console or Firebase CLI before enabling shared use. Do not replace it with public `allow read, write: if true` rules.

### First shared-workspace administrator

1. In Firebase Console → **Authentication** → **Sign-in method**, enable **Email/Password**. Disable Google if Studio should use passwords only.
2. In Firebase Console → **Authentication** → **Users**, create the first Studio user with an email address and a strong temporary password.
3. Copy that user’s UID.
4. In Firestore, create `studioUsers/{UID}` with `{ "role": "admin" }`.
5. Deploy `firestore.rules` and refresh Studio.
6. The administrator signs in through Studio, then can save a draft and verify the top-bar status reads **Shared workspace is in sync**.

Studio intentionally has no public sign-up form. An administrator first creates each authentication account in Firebase Console, then uses **People and activity** in Studio to add that account UID, email address, role, and active status. Studio never stores or receives another user’s password.

The same panel provides a password-reset request and an immutable activity feed. Deactivating a member immediately removes Studio permissions through Firestore rules (it does not delete the Firebase Authentication account).

## Run the Studio locally

```bash
npm install
npm run dev
```

Then open the localhost link shown in the terminal.



## Client projects (multi-tenant workspaces)

Studio supports multiple client projects without deploying a separate copy of Studio for each client. A project has its own display name, Android/iOS package identifier, member list, screen catalog, drafts, and published document versions.

- **Demo workspace** remains the legacy/default project, so existing screens continue to work unchanged.
- An **admin** creates a project from the left-side project switcher and becomes its first member.
- Project screens are stored under project-scoped Firestore IDs; routes such as `home` and `wallet` can therefore exist independently for different clients.
- Firestore rules permit only project members to read a project, and only designer/admin members to write it.

Before enabling this in Firebase, deploy the current `firestore.rules`. Existing administrators can then create a client project. Add other users' Firebase Authentication UIDs to its `memberIds` field in Firestore until the member-management screen adds project membership controls.

The mobile host must select the client project when it requests a remote screen (for example `projectId: "acme-banking-…"`). The current demo app deliberately continues to load the legacy project until that host integration is enabled.
