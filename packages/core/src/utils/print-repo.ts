import type { Repo } from '@teapot/contract';

export function printRepo(repo: Repo): void {
  console.log('Repository Model:');
  console.log('=================');
  console.log(`Path: ${repo.path}`);
  console.log(`\nBranches (${repo.branches.length}):`);

  const sortedBranches = [...repo.branches].sort((a, b) => {
    if (a.isTrunk && !b.isTrunk) return -1;
    if (!a.isTrunk && b.isTrunk) return 1;
    if (a.isRemote && !b.isRemote) return 1;
    if (!a.isRemote && b.isRemote) return -1;
    return a.ref.localeCompare(b.ref);
  });

  sortedBranches.forEach((branch) => {
    const trunkMarker = branch.isTrunk ? ' (TRUNK)' : '';
    const remoteMarker = branch.isRemote ? ' [remote]' : ' [local]';
    const headSha = branch.headSha || 'unknown';
    console.log(`  - ${branch.ref}${trunkMarker}${remoteMarker} -> ${headSha}`);
  });

  console.log(`\nCommits (${repo.commits.length}):`);
  repo.commits.forEach((commit) => {
    const timestamp =
      commit.timeMs > 0 ? new Date(commit.timeMs).toISOString() : 'unknown date';
    const parent = commit.parentSha || 'none';
    const children =
      commit.childrenSha.length > 0 ? commit.childrenSha.join(', ') : 'none';
    const message = commit.message.split('\n')[0] || '(no message)';
    console.log(`  - ${commit.sha}`);
    console.log(`      message : ${message}`);
    console.log(`      time    : ${timestamp}`);
    console.log(`      parent  : ${parent}`);
    console.log(`      children: ${children}`);
  });
}
