# FlexFlow UI

FlexFlow UI is an internal portal for creating, previewing, versioning, and publishing mobile interface documents.

It also includes **FlexFlow UI Exporter**, a local Figma development plugin that converts a selected design frame into a reviewable JSON starting point.

The Studio editor also includes **Figma to JSON**. Open the converter next to the JSON editor, enter a Figma design URL or file key, a node ID (or a URL containing `node-id`), and a Figma personal access token with `file_content:read`. The server fetches only that node, converts it with the shared engine, and returns JSON plus layer warnings. The token is cleared from the form after the request and is not stored with the screen. Review, copy, or download the JSON before choosing **Apply to draft**. Saving and publishing remain separate actions.

## First MVP capabilities

- Screen directory with draft and published versions
- Form-led properties plus an advanced JSON editor
- Approved data-binding picker and sample response panel
- Mobile-shaped preview
- Draft, publish, and rollback interactions
- Shared Firestore drafts and published versions after sign-in
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

FlexFlow UI manages layouts and approved binding paths only. It does not store API credentials or permit arbitrary API endpoint calls. The server validates the document, role, project membership, and release actions before saving a version. Web URL actions require an origin listed in `FLEXFLOW_ALLOWED_URL_ORIGINS`; direct API-call actions cannot be published.

### Server setup for saving and publishing

The Next.js server needs Firebase Admin credentials through Application Default Credentials. On a managed Google runtime, assign its service account the required Firestore and Authentication permissions. For local development, set `GOOGLE_APPLICATION_CREDENTIALS` to a service account JSON file outside this repository. Set `FIREBASE_ADMIN_PROJECT_ID` if the project ID is not supplied by the runtime. Never put a service account key in a `NEXT_PUBLIC_` variable or commit it.

Set `FLEXFLOW_ALLOWED_URL_ORIGINS` to a comma-separated list of HTTPS origins if released documents may open web URLs, for example `https://example.com,https://help.example.com`. With no origins configured, URL actions cannot be published.

Deploy the server code first, then deploy the updated `firestore.rules`. The rules block browser writes to screen metadata and version documents; drafts, publishing, archive, and restore now use the authenticated server endpoint. A server deployment is required for those actions to work.

For existing screens, the first server save inspects older version documents to recover the highest saved and published numbers. New saves retain separate `latestDraftVersion` and `publishedVersion` pointers. Saving a draft leaves the published version live; publishing assigns the next number in a transaction with the screen record, immutable version, route reservation, and audit entry.

The Android reference app reads `GET /api/published-screens/{route}`. This public endpoint serves only an active published version from the legacy project. Draft and archived screens return 404. It uses Firebase Admin on the server; mobile clients do not need Studio membership or direct Firestore access.

## Shared Firestore workspace

An administrator-created email/password account is required to open the editor. Saving a draft or publishing a version requires the configured Firebase Admin server endpoint. If Firebase is not configured, the sign-in page explains that setup is unavailable.

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
- `admin`: designer permissions plus user-role administration.

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

## Browser release checks

Phase 4 runs the signed-in editor against local Firebase Authentication and Firestore emulators. It creates throwaway admin and reviewer accounts in the `demo-flexflow-ui` emulator project; no live Firebase credentials or data are used. The browser checks cover desktop, tablet, phone, and narrow phone widths, including draft save, preview states, publish validation, live-versus-draft labels, archive/restore, keyboard drawer behavior, and reviewer role denial.

Install Java 21 and a Playwright Chromium browser, then run:

```bash
npm ci
npx playwright install chromium
npm run test:e2e
```

GitHub CI runs the same checks on every pull request and `main` push. Failed runs upload a Playwright report and trace for diagnosis.

Phase 6 adds Firefox and WebKit browser engines. After a `main` push, CI also waits for the Firebase App Hosting rollout check on that exact commit and confirms the live URL responds. Follow [the release checklist](docs/release-checklist.md) to compare the current App Hosting rollout commit and complete the real-device pass.



## Client projects (multi-tenant workspaces)

Studio supports multiple client projects without deploying a separate copy of Studio for each client. A project has its own display name, Android/iOS package identifier, member list, screen catalog, drafts, and published document versions.

- **Demo workspace** remains the legacy/default project, so existing screens continue to work unchanged.
- An **admin** creates a project from the left-side project switcher and becomes its first member.
- Project screens are stored under project-scoped Firestore IDs; routes such as `home` and `wallet` can therefore exist independently for different clients.
- Firestore rules permit only project members to read a project, and only designer/admin members to write it.

Admins can add and remove existing, active Studio members in the Governance view after selecting a client project. The server validates each change, keeps the acting admin in the project, and records an audit entry. Create Firebase Authentication accounts and Studio access records before adding them to a project.

Deploy the updated server before publishing `firestore.rules`. The updated rules reserve project membership updates for the authenticated server endpoint; they do not allow direct browser edits to a project's `memberIds`.

The mobile host must select the client project when it requests a remote screen (for example `projectId: "acme-banking-…"`). The current demo app deliberately continues to load the legacy project until that host integration is enabled.


