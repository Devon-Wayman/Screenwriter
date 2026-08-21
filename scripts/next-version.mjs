const [localVersion, deployedVersion, release = 'patch'] = process.argv.slice(2);

function parse(value) {
  const match = String(value || '').trim().match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
  return match ? match.slice(1).map(Number) : null;
}

function compare(left, right) {
  for (let index = 0; index < 3; index++) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

const local = parse(localVersion);
const deployed = parse(deployedVersion);
if (!local) {
  console.error(`Invalid local semantic version: ${localVersion}`);
  process.exit(1);
}
if (!['patch', 'minor', 'major', 'none'].includes(release)) {
  console.error(`Invalid release type: ${release}`);
  process.exit(1);
}

const next = [...(deployed && compare(deployed, local) > 0 ? deployed : local)];
if (release === 'major') { next[0]++; next[1] = 0; next[2] = 0; }
if (release === 'minor') { next[1]++; next[2] = 0; }
if (release === 'patch') next[2]++;
process.stdout.write(next.join('.'));
