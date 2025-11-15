import type { Repo } from '../models.js';

export function printRepo(repo: Repo): void {
  console.log('Repository Model:');
  console.log('=================');
  console.log(`Path: ${repo.path}`);
  console.log(`\nBranches (${repo.branches.length}):`);

  // Sort branches so trunk appears first
  const sortedBranches = [...repo.branches].sort((a, b) => {
    if (a.isTrunk) return -1;
    if (b.isTrunk) return 1;
    return 0;
  });

  sortedBranches.forEach((branch) => {
    const trunkMarker = branch.isTrunk ? ' (TRUNK)' : '';
    console.log(`  - ${branch.ref}${trunkMarker}`);
  });
}
