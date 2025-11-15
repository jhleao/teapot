import git from 'isomorphic-git';
import fs from 'fs';
import type { Configuration, Repo, Branch, Commit } from '@teapot/contract';
import { getTrunkBranchRef } from './get-trunk.js';

type BranchDescriptor = {
  ref: string;
  fullRef: string;
  isRemote: boolean;
};

export async function buildRepoModel(config: Configuration): Promise<Repo> {
  const dir = config.repoPath;

  const localBranches = await git.listBranches({
    fs,
    dir,
  });
  const trunkBranch = await getTrunkBranchRef(config, localBranches);

  const branchDescriptors = await collectBranchDescriptors(dir, localBranches);
  const branches = await buildBranchesFromDescriptors(
    dir,
    branchDescriptors,
    trunkBranch
  );
  const commits = await collectCommitsFromDescriptors(
    dir,
    branchDescriptors,
    branches
  );

  return {
    path: dir,
    commits,
    branches,
  };
}

async function collectBranchDescriptors(
  dir: string,
  localBranches: string[]
): Promise<BranchDescriptor[]> {
  const branchDescriptors: BranchDescriptor[] = localBranches
    .filter((ref) => !isSymbolicBranch(ref))
    .map((ref) => ({
      ref,
      fullRef: `refs/heads/${ref}`,
      isRemote: false,
    }));

  let remotes: { remote: string; url: string }[] = [];
  try {
    remotes = await git.listRemotes({ fs, dir });
  } catch {
    remotes = [];
  }

  for (const remote of remotes) {
    try {
      const remoteBranches = await git.listBranches({
        fs,
        dir,
        remote: remote.remote,
      });

      remoteBranches.forEach((remoteBranch) => {
        if (isSymbolicBranch(remoteBranch)) {
          return;
        }
        branchDescriptors.push({
          ref: `${remote.remote}/${remoteBranch}`,
          fullRef: `refs/remotes/${remote.remote}/${remoteBranch}`,
          isRemote: true,
        });
      });
    } catch {
      // Ignore remotes we cannot read
    }
  }

  return branchDescriptors;
}

async function buildBranchesFromDescriptors(
  dir: string,
  branchDescriptors: BranchDescriptor[],
  trunkBranch: string | null
): Promise<Branch[]> {
  const branches: Branch[] = [];

  for (const descriptor of branchDescriptors) {
    const headSha = await resolveBranchHead(dir, descriptor.fullRef);
    const normalizedRef = getBranchName(descriptor);
    branches.push({
      ref: descriptor.ref,
      isTrunk: Boolean(trunkBranch && normalizedRef === trunkBranch),
      isRemote: descriptor.isRemote,
      headSha,
    });
  }

  return branches;
}

async function collectCommitsFromDescriptors(
  dir: string,
  branchDescriptors: BranchDescriptor[],
  branches: Branch[]
): Promise<Commit[]> {
  const commitsMap = new Map<string, Commit>();

  for (let i = 0; i < branchDescriptors.length; i += 1) {
    const descriptor = branchDescriptors[i];
    const branch = branches[i];
    const headSha = branch?.headSha;
    if (!headSha) {
      continue;
    }
    await collectCommitsForRef(dir, descriptor.fullRef, commitsMap);
  }

  return Array.from(commitsMap.values()).sort((a, b) => b.timeMs - a.timeMs);
}

async function resolveBranchHead(dir: string, ref: string): Promise<string> {
  try {
    return await git.resolveRef({
      fs,
      dir,
      ref,
    });
  } catch {
    return '';
  }
}

async function collectCommitsForRef(
  dir: string,
  ref: string,
  commitsMap: Map<string, Commit>
): Promise<void> {
  try {
    const logEntries = await git.log({
      fs,
      dir,
      ref,
    });

    for (const entry of logEntries) {
      const sha = entry.oid;
      const commit = ensureCommit(commitsMap, sha);
      commit.message = entry.commit.message.trim();
      commit.timeMs = (entry.commit.author?.timestamp ?? 0) * 1000;

      const parentSha = entry.commit.parent?.[0] ?? '';
      commit.parentSha = parentSha;

      if (parentSha) {
        const parentCommit = ensureCommit(commitsMap, parentSha);
        if (!parentCommit.childrenSha.includes(sha)) {
          parentCommit.childrenSha.push(sha);
        }
      }
    }
  } catch {
    // Ignore branches we cannot traverse (e.g. shallow clones)
  }
}

function ensureCommit(commitsMap: Map<string, Commit>, sha: string): Commit {
  let commit = commitsMap.get(sha);
  if (!commit) {
    commit = {
      sha,
      message: '',
      timeMs: 0,
      parentSha: '',
      childrenSha: [],
    };
    commitsMap.set(sha, commit);
  }
  return commit;
}

function getBranchName(descriptor: BranchDescriptor): string {
  if (!descriptor.isRemote) {
    return descriptor.ref;
  }

  const slashIndex = descriptor.ref.indexOf('/');
  return slashIndex >= 0 ? descriptor.ref.slice(slashIndex + 1) : descriptor.ref;
}

function isSymbolicBranch(ref: string): boolean {
  return ref === 'HEAD' || ref.endsWith('/HEAD');
}
