import dotenv from 'dotenv';
import type { Configuration } from './models.js';

dotenv.config();

export function loadConfiguration(): Configuration {
  const repoPath = process.env.REPO_PATH || process.cwd();

  return { repoPath };
}
