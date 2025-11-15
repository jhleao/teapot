import git from 'isomorphic-git';
import fs from 'fs';
import type { Repo, Branch, Configuration } from './models.js';
import { getTrunkBranchRef } from './utils/get-trunk.js';
import { printRepo } from './utils/print-repo.js';
import { loadConfiguration } from './config.js';

async function buildRepoModel(config: Configuration): Promise<Repo> {
  const branches = await git.listBranches({
    fs,
    dir: config.repoPath,
  });

  const trunkBranch = await getTrunkBranchRef(config, branches);

  const branchObjects: Branch[] = branches.map((branchRef) => {
    const isTrunk = branchRef === trunkBranch;
    return {
      ref: branchRef,
      isTrunk,
    };
  });

  return {
    path: config.repoPath,
    branches: branchObjects,
  };
}

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
