import { execFileSync } from 'node:child_process';

const base = process.env.BASE_SHA;
if (!base || /^0+$/.test(base)) {
  console.log('Initial repository creation: no previous edition baseline.');
} else {
  if (!/^[a-f0-9]{40,64}$/i.test(base)) throw new Error('Invalid base commit');
  const output = execFileSync('git', ['diff', '--name-status', '--no-renames', `${base}..HEAD`, '--', 'reports'], { encoding: 'utf8' });
  const invalid = output.trim().split('\n').filter(Boolean).filter(line => !line.startsWith('A\t'));
  if (invalid.length) throw new Error(`Published editions are append-only. Publish a correction revision instead:\n${invalid.join('\n')}`);
  console.log('Previous report editions unchanged.');
}
