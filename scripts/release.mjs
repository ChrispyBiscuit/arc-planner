// Publishes a new version: builds the installer and creates the GitHub release that installed copies update from.
//   1. Bump "version" in package.json and commit.
//   2. npm run release
// Needs the GitHub CLI (gh) signed in with access to the repository.
import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'

const { version, build } = JSON.parse(readFileSync('package.json', 'utf8'))
const tag = `v${version}`
const repo = `${build.publish.owner}/${build.publish.repo}`
const sh = (cmd, args) => execFileSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32' })

sh('npx', ['electron-builder', '--win', '--publish', 'never'])
const exe = `dist/Arc-Planner-Setup-${version}.exe`
const files = [exe, `${exe}.blockmap`, 'dist/latest.yml']
for (const f of files) if (!existsSync(f)) throw new Error(`Missing ${f}`)
// latest.yml is what installed copies read to learn that a newer version exists.
sh('gh', ['release', 'create', tag, ...files, '--repo', repo, '--title', `"Arc Planner ${version}"`, '--generate-notes'])
console.log(`Released ${tag}. Installed copies pick it up within six hours, or at once from the tray menu.`)
