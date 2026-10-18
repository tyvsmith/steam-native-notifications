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

test('numbered releases include the Bun tarball with explicit notes', () => {
  const publish = workflows.release.jobs.release.steps.find((step: any) => step.name === 'Create the GitHub release');
  expect(publish.run).toContain('dist/releases/*.tgz dist/releases/*.tgz.sha256');
  expect(publish.run).toContain('--notes-file dist/release-notes.md');
  expect(publish.run).not.toContain('--generate-notes');
});

test('dry-run publication remains disabled and local package coverage remains enabled', () => {
  expect(workflows.release.on.workflow_dispatch.inputs.dry_run.default).toBe(true);
  const publish = workflows.release.jobs.release.steps.find((step: any) => step.name === 'Create the GitHub release');
  expect(publish.if).toBe('${{ !inputs.dry_run }}');
  const builds = workflows.build.jobs.build.steps.map((step: any) => step.run);
  expect(builds).toContain('bun tools/build-release.ts');
  expect(builds).toContain('bun tools/test-packaged.ts');
});


test('npm publication requires a manual run and an explicit publishing choice', () => {
  const workflow = workflows['npm-publish'];
  const npm = workflow.jobs.npm;
  expect(Object.keys(workflow.on)).toEqual(['workflow_dispatch']);
  expect(workflow.on.workflow_dispatch.inputs.dry_run.default).toBe(true);
  expect(npm.if).toBe("${{ startsWith(github.ref, 'refs/tags/v') }}");
  expect(npm.environment).toBe('npm');
  expect(npm.permissions).toEqual({ contents: 'read', 'id-token': 'write' });
  const publish = npm.steps.find((step: any) => step.name === 'Publish the validated tarball through npm OIDC');
  expect(publish.if).toBe('${{ !inputs.dry_run }}');
  expect(publish.run).toContain('npm publish dist/releases/*.tgz');
  expect(publish.run).toContain('--ignore-scripts');
  expect(publish.run).toContain('channel=next');
  expect(JSON.stringify(npm)).not.toContain('secrets.');
  const download = npm.steps.find((step: any) => step.name === 'Download the numbered release package');
  expect(download.run).toContain('gh release download');
  const checks = npm.steps.find((step: any) => step.name === 'Check the exact release package');
  expect(checks.run).toContain('sha256sum --check');
  expect(checks.run).toContain('process.env.TAG');
  expect(checks.run).toContain('bun tools/verify-release-source.ts');
  expect(npm.steps.some((step: any) => step.run === 'bun tools/gen-proto.mjs')).toBe(true);
});
