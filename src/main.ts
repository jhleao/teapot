import { printRepo } from './utils/print-repo.js';
import { loadConfiguration } from './config.js';
import { buildRepoModel } from './utils/build-repo.js';

export async function main() {
  try {
    const config = loadConfiguration();
    console.log(`Building repository model for: ${config.repoPath}\n`);

    const repo = await buildRepoModel(config);
    printRepo(repo);
  } catch (error) {
    console.error('Error building repository model:', error);
    process.exit(1);
  }
}

main();
