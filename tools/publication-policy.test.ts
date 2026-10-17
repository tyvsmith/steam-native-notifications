import { expect, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';

// Remove this gate only with the complete runtime distribution materials.
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

test('CI exports only the Millennium plugin while standalone distribution is gated', () => {
  const uploads = steps.filter(step => step.uses?.startsWith('actions/upload-artifact@'));
  expect(uploads.length).toBeGreaterThan(0);
  for (const step of uploads) expect(step.with.path).toBe(`dist/${star}`);
  const downloads = steps.filter(step => step.uses?.startsWith('actions/download-artifact@'));
  for (const step of downloads) expect(step.with.name).toBe(star);
});

test('release attachment commands remain restricted to the plugin', () => {
  const commands = steps.flatMap(step => (step.run ?? '').split('\n'))
    .filter((line: string) => /gh release (create|upload) /.test(line));
  expect(commands).toHaveLength(3);
  for (const command of commands) {
    // Both current publication paths explicitly name the one allowed asset.
    expect(command).toMatch(/gh release (?:create|upload) (?:latest "\$star"|"\$TAG" dist\/me\.tysmith\.steam-native-notifications\.star)(?: |$)/);
    expect(command).not.toMatch(/\*|\.tar|\.sha256|releases\//);
  }
  const latest = workflows.ci.jobs.latest.steps.find((step: any) => step.name === 'Publish the .star under the latest pre-release');
  expect(latest.run).toContain(`star=dist/${star}`);
});

test('dry-run publication remains disabled and local package coverage remains enabled', () => {
  expect(workflows.release.on.workflow_dispatch.inputs.dry_run.default).toBe(true);
  const publish = workflows.release.jobs.release.steps.find((step: any) => step.name === 'Create the GitHub release');
  expect(publish.if).toBe('${{ !inputs.dry_run }}');
  const builds = workflows.build.jobs.build.steps.map((step: any) => step.run);
  expect(builds).toContain('bun tools/build-release.ts');
  expect(builds).toContain('bun tools/test-packaged.ts');
});
