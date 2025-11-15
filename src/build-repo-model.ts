import git from 'isomorphic-git';
import fs from 'fs';
import type { Repo, Branch } from './models.js';
import { getTrunkBranchRef } from './utils/get-trunk.js';
import { printRepo } from './utils/print-repo.js';

async function buildRepoModel(repoPath: string): Promise<Repo> {
  const branches = await git.listBranches({
    fs,
    dir: repoPath,
  });

  const trunkBranch = await getTrunkBranchRef(repoPath, branches);

  const branchObjects: Branch[] = branches.map((branchRef) => {
    const isTrunk = branchRef === trunkBranch;
    return {
      ref: branchRef,
      isTrunk,
    };
  });

  return {
    path: repoPath,
    branches: branchObjects,
  };
}

export async function main() {
  try {
    // Use current directory as the repo path
    const repoPath = process.cwd();
    console.log(`Building repository model for: ${repoPath}\n`);

    const repo = await buildRepoModel(repoPath);
    printRepo(repo);
  } catch (error) {
    console.error('Error building repository model:', error);
    process.exit(1);
  }
}

main();
