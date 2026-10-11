import { existsSync } from 'node:fs';
import { join } from 'node:path';

export function findChrome(): string | undefined {
  const candidates = process.platform === 'darwin'
    ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
    : process.platform === 'win32'
      ? [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA]
          .filter((root): root is string => !!root).map(root => join(root, 'Google', 'Chrome', 'Application', 'chrome.exe'))
      : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable'];
  return candidates.find(path => existsSync(path));
}
