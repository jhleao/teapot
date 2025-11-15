import dotenv from 'dotenv';
import type { Configuration } from '@teapot/contract';

dotenv.config({ path: '../../.env' });

export function loadConfiguration(): Configuration {
  const repoPath = process.env.REPO_PATH || process.cwd();

  return { repoPath };
}
