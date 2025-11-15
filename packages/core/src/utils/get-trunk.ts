import git from 'isomorphic-git';
import fs from 'fs';
import type { Configuration } from '@teapot/contract';

export async function getTrunkBranchRef(
  config: Configuration,
  branches: string[]
): Promise<string | null> {
  const dir = config.repoPath;

  const remoteHeadBranch = await resolveBranchFromRef(dir, 'refs/remotes/origin/HEAD');
  if (remoteHeadBranch) {
    console.log(`Inferred trunk branch from origin/HEAD: ${remoteHeadBranch}`);
    return remoteHeadBranch;
  }

  const currentBranch = await resolveBranchFromRef(dir, 'HEAD');
  if (currentBranch && branches.includes(currentBranch)) {
    console.log(`Using current branch as trunk: ${currentBranch}`);
    return currentBranch;
  }

  console.log('Could not infer trunk from origin/HEAD, using fallback sources');

  // Fallback: Common trunk branch names in order of preference
  const trunkCandidates = ['main', 'master', 'develop'];
  return (
    trunkCandidates.find((name) => branches.includes(name)) ||
    branches[0] ||
    null
  );
}

async function resolveBranchFromRef(
  dir: string,
  ref: string
): Promise<string | null> {
  try {
    const resolvedRef = await git.resolveRef({
      fs,
      dir,
      ref,
      depth: 2,
    });
    const match = resolvedRef.match(/refs\/(?:heads|remotes\/[^/]+)\/(.+)/);
    return match ? match[1] : null;
  } catch (error) {
    return null;
  }
}
