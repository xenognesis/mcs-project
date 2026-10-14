import { publishWorldState } from './electron/world.ts';

async function fix() {
  const driveRoot = 'G:\\Mi unidad\\MCS';
  console.log(`Publishing state for ${driveRoot}...`);
  const hash = await publishWorldState(driveRoot, 'Admin');
  console.log(`Success! New hash: ${hash}`);
}

fix().catch(console.error);
