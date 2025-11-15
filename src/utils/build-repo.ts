import git from 'isomorphic-git';
import fs from 'fs';
import type { Configuration, Repo, Branch } from '../models';
import { getTrunkBranchRef } from './get-trunk';

export async function buildRepoModel(config: Configuration): Promise<Repo> {
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
