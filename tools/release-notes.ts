import { execFileSync } from 'node:child_process';

// Git supplies reachable tags, newest first; never let the moving tag define the range.
export function previousNumberedTag(tags: string[], current: string): string | undefined {
    return tags.find(tag => tag !== current && /^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(tag));
}

export function releaseNotes(log: string): string {
    return log.trim().split('\n').filter(Boolean).map(line => `- ${line}`).join('\n') + '\n';
}

if (import.meta.main) {
    const tag = process.argv[2];
    if (!/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(tag ?? '')) throw new Error('Expected a numbered release tag');
    const git = (...args: string[]) => execFileSync('git', args, { encoding: 'utf8' }).trim();
    const tags = git('tag', '--merged', 'HEAD', '--sort=-creatordate').split('\n');
    const previous = previousNumberedTag(tags, tag);
    const log = git('log', '--format=%h %s', previous ? `${previous}..HEAD` : 'HEAD');
    process.stdout.write(releaseNotes(log));
}
