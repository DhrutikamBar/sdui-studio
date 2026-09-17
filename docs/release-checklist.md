# FlexFlow UI release check

## Automated gate

1. Merge only after the pull request's `build` and `browser-flow` jobs pass. The browser suite covers Chromium at desktop, tablet, phone, and narrow phone widths; Firefox desktop; and WebKit desktop and phone emulation.
2. After a `main` push, wait for `live-rollout`. It checks that the Firebase App Hosting GitHub check succeeded for the exact merge commit, then confirms the hosted URL serves FlexFlow UI.
3. In Firebase Console → App Hosting → `sdui-studio` → Rollouts, compare the **current rollout's commit** with the merge commit on GitHub. This is the source of truth for which code is serving. A successful HTTP response alone does not identify the deployed commit.

## Manual device pass

Use a test account and a disposable screen in a test client project. Test at least one current iPhone in Safari, one Android phone in Chrome, and a tablet. Record device, OS, browser, and result.

- Sign in and switch projects. Confirm only assigned projects appear.
- Open and close the library drawer; check focus return, scrolling, and no horizontal overflow.
- Build a simple screen, preview content/loading/empty/error/retry states, and check that wallet scenarios appear only for wallet-bound documents.
- Save a draft, confirm the sidebar label, then publish with preview confirmation and release note. Save another draft and confirm the published version remains live.
- As an admin, add and remove a test Studio member in Governance. Confirm the member sees or loses the client project and that both actions appear in the audit history. Confirm a reviewer cannot manage members.
- Check keyboard navigation, visible focus, and screen-reader announcements on the sign-in, drawer, preview dialog, and release controls.
- Archive the disposable screen after testing. Confirm the normal project and published screens are unchanged.

If a live issue appears, use the App Hosting Rollouts history to restore the last known good build, then verify its current commit and repeat the smoke check.
