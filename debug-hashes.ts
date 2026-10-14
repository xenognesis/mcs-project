import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { readPublishedHash, hashDirectory } from './electron/world.ts';

// Copying the files function to get the raw list
import { readdir } from 'node:fs/promises';
async function files(root: string, relative = ''): Promise<string[]> {
  const entries = await readdir(path.join(root, relative), { withFileTypes: true });
  const list: string[] = [];
  for (const entry of entries) {
    const next = path.join(relative, entry.name);
    if (entry.isDirectory()) list.push(...await files(root, next)); else if (entry.isFile()) list.push(next);
  }
  return list.sort();
}

async function debug() {
  const driveRoot = 'G:\\Mi unidad\\MCS';
  const worldRoot = path.join(driveRoot, 'world');
  
  const published = await readPublishedHash(driveRoot);
  const local = await hashDirectory(worldRoot);
  
  console.log('Published hash:', published);
  console.log('Local hash:    ', local);
  
  if (published !== local) {
    console.log('MISMATCH DETECTED. Generating individual file hashes for current local state...');
    const allFiles = await files(worldRoot);
    const fileHashes: Record<string, string> = {};
    for (const f of allFiles) {
      const content = await readFile(path.join(worldRoot, f));
      fileHashes[f] = createHash('sha256').update(content).digest('hex');
    }
    await require('node:fs/promises').writeFile('debug-local-state.json', JSON.stringify(fileHashes, null, 2));
    console.log('Wrote current file hashes to debug-local-state.json');
  }
}

debug().catch(console.error);
