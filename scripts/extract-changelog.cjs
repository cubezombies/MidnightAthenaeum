'use strict';

// Pulls one version's section out of CHANGELOG.md so CI can use it as the
// GitHub Release body — which is also where electron-updater reads the
// release notes shown in the app's "Check for Updates" screen from.
//
// Usage: node extract-changelog.cjs <tag-or-version> [outFile]

const fs = require('node:fs');
const path = require('node:path');

const rawArg = process.argv[2];
const outFile = process.argv[3] || 'release-notes.md';

if (!rawArg) {
  console.error('Usage: extract-changelog.cjs <tag-or-version> [outFile]');
  process.exit(1);
}

const version = rawArg.replace(/^v/, '');
const changelogPath = path.join(__dirname, '..', 'CHANGELOG.md');
const changelog = fs.readFileSync(changelogPath, 'utf8');

const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const headerRe = new RegExp(`^##\\s*\\[${escaped}\\].*$`, 'm');
const match = headerRe.exec(changelog);

if (!match) {
  console.error(`No CHANGELOG.md section found for version ${version} (looked for "## [${version}]").`);
  process.exit(1);
}

const afterHeader = changelog.slice(match.index + match[0].length);
const nextHeaderMatch = /\n##\s*\[/.exec(afterHeader);
const section = (nextHeaderMatch ? afterHeader.slice(0, nextHeaderMatch.index) : afterHeader).trim();

if (!section) {
  console.error(`Section for version ${version} is empty.`);
  process.exit(1);
}

fs.writeFileSync(outFile, section + '\n', 'utf8');
console.log(`Wrote release notes for ${version} to ${outFile}`);
