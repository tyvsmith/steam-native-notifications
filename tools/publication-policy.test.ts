import { expect, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';

const star = 'me.tysmith.steam-native-notifications.star';
const workflowDirectory = new URL('../.github/workflows/', import.meta.url);
const workflows = Object.fromEntries(readdirSync(workflowDirectory)
  .filter(name => /\.ya?ml$/.test(name))
  .map(name => [
    name.replace(/\.ya?ml$/, ''),
    Bun.YAML.parse(readFileSync(new URL(name, workflowDirectory), 'utf8')) as any,
  ]));
const steps = Object.values(workflows).flatMap(workflow =>
  Object.values(workflow.jobs).flatMap((job: any) => job.steps ?? []));

test('CI exports the plugin and validated Bun package only', () => {
  const uploads = steps.filter(step => step.uses?.startsWith('actions/upload-artifact@'));
  expect(uploads).toHaveLength(2);
  expect(uploads[0].with.path).toBe(`dist/${star}`);
  expect(uploads[1].with.name).toBe('standalone-bun-package');
  expect(uploads[1].with.path.trim().split('\n')).toEqual(['dist/releases/*.tgz', 'dist/releases/*.tgz.sha256']);
});

test('numbered releases include the Bun tarball without publishing to a registry', () => {
  const publish = workflows.release.jobs.release.steps.find((step: any) => step.name === 'Create the GitHub release');
  expect(publish.run).toContain('dist/releases/*.tgz dist/releases/*.tgz.sha256');
  for (const step of steps) expect(step.run ?? '').not.toMatch(/(?:npm|bun) publish/);
});

test('dry-run publication remains disabled and local package coverage remains enabled', () => {
  expect(workflows.release.on.workflow_dispatch.inputs.dry_run.default).toBe(true);
  const publish = workflows.release.jobs.release.steps.find((step: any) => step.name === 'Create the GitHub release');
  expect(publish.if).toBe('${{ !inputs.dry_run }}');
  const builds = workflows.build.jobs.build.steps.map((step: any) => step.run);
  expect(builds).toContain('bun tools/build-release.ts');
  expect(builds).toContain('bun tools/test-packaged.ts');
});
