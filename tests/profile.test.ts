import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { deleteChromeProfile } from '../src/main/profile';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'form-entry-profile-test-')); roots.push(root);
  const profile = join(root, 'chrome-profile'); await mkdir(profile);
  await writeFile(join(profile, 'Cookies'), 'fixture'); await writeFile(join(root, 'phase0.sqlite'), 'keep history');
  return { root, profile };
}
describe('delete owned Chrome profile', () => {
  it('removes the profile only, preserving the database and allowing missing profiles', async () => {
    const { root, profile } = await fixture();
    await deleteChromeProfile(root);
    await expect(readFile(join(profile, 'Cookies'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(join(root, 'phase0.sqlite'), 'utf8')).toBe('keep history');
    await deleteChromeProfile(root);
  });
  it('rejects even a dangling Chrome lock without removing profile data', async () => {
    const { root, profile } = await fixture();
    await symlink('fixture-host-12345', join(profile, 'SingletonLock'));
    await expect(deleteChromeProfile(root)).rejects.toThrow('PROFILE_IN_USE');
    expect(await readFile(join(profile, 'Cookies'), 'utf8')).toBe('fixture');
  });
});
