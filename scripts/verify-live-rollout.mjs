const { GITHUB_REPOSITORY: repository, GITHUB_SHA: sha, GITHUB_TOKEN: token, APP_HOSTING_CHECK_NAME: checkName, FLEXFLOW_LIVE_URL: liveUrl } = process.env;

if (!/^[\w.-]+\/[\w.-]+$/.test(repository ?? '') || !/^[a-f0-9]{40}$/.test(sha ?? '') || !token || !checkName || !liveUrl) {
  throw new Error('Release verification needs the GitHub repository, commit, token, App Hosting check name, and live URL.');
}

const deadline = Date.now() + 15 * 60_000;
const apiUrl = `https://api.github.com/repos/${repository}/commits/${sha}/check-runs?per_page=100`;
let rolloutConfirmed = false;

while (Date.now() < deadline) {
  const response = await fetch(apiUrl, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Could not read GitHub rollout checks (${response.status}).`);
  const payload = await response.json();
  const check = payload.check_runs?.find((item) => item.name === checkName);
  if (check?.status === 'completed') {
    if (check.conclusion !== 'success') throw new Error(`App Hosting rollout for ${sha} ended with ${check.conclusion}.`);
    rolloutConfirmed = true;
    console.log(`App Hosting reports a successful rollout for commit ${sha}.`);
    break;
  }
  await new Promise((resolve) => setTimeout(resolve, 15_000));
}

if (!rolloutConfirmed) throw new Error(`App Hosting did not confirm rollout for ${sha} within 15 minutes.`);

const liveDeadline = Date.now() + 2 * 60_000;
let liveConfirmed = false;
while (Date.now() < liveDeadline) {
  try {
    const url = new URL(liveUrl);
    url.searchParams.set('release_check', sha);
    const response = await fetch(url, { headers: { 'Cache-Control': 'no-cache' }, signal: AbortSignal.timeout(15_000) });
    const html = await response.text();
    if (response.ok && html.includes('FlexFlow UI')) {
      console.log(`Live FlexFlow UI responded successfully at ${url.origin}.`);
      liveConfirmed = true;
      break;
    }
    console.log(`Waiting for the live site: HTTP ${response.status}.`);
  } catch (error) {
    console.log(`Waiting for the live site: ${error instanceof Error ? error.message : 'request failed'}`);
  }
  await new Promise((resolve) => setTimeout(resolve, 15_000));
}

if (!liveConfirmed) throw new Error('App Hosting rolled out, but the live site did not respond successfully within 2 minutes.');
