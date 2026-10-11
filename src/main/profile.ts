import { lstat, rm } from 'node:fs/promises';
import { join } from 'node:path';

export async function deleteChromeProfile(dataPath: string) {
  const profile = join(dataPath, 'chrome-profile');
  // lstat also detects a dangling lock from a browser we no longer own.
  if (await lstat(join(profile, 'SingletonLock')).catch(error => { if (error.code === 'ENOENT') return undefined; throw error; })) throw new Error('PROFILE_IN_USE');
  await rm(profile, { recursive: true, force: true });
}
