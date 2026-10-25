import { expect, test } from 'bun:test';
import { privateDirectory, powershell, psQuote } from './windows';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test.skipIf(process.platform !== 'win32')('private directory protection is repeatable without security privileges', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'snn-win-acl-'));
    try {
        for (let i = 0; i < 3; i++) await privateDirectory(dir);
        const acl = JSON.parse(await powershell(`$acl=Get-Acl -LiteralPath ${psQuote(dir)}; @{protected=$acl.AreAccessRulesProtected; rules=@($acl.Access | ForEach-Object { @{sid=$_.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value; rights=[string]$_.FileSystemRights; inherited=$_.IsInherited; type=[string]$_.AccessControlType} }); user=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value}|ConvertTo-Json -Depth 4`));
        expect(acl.protected).toBe(true);
        expect(acl.rules).toHaveLength(2);
        expect(acl.rules.map((r: any) => r.sid).sort()).toEqual([acl.user, 'S-1-5-18'].sort());
        for (const rule of acl.rules) {
            expect(rule.rights).toBe('FullControl');
            expect(rule.inherited).toBe(false);
            expect(rule.type).toBe('Allow');
        }
    } finally { await rm(dir, { recursive: true, force: true }); }
}, 60000);
