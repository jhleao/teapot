import type { Repo } from '../models.js';

export function printRepo(repo: Repo): void {
  console.log('Repository Model:');
  console.log('=================');
  console.log(`Path: ${repo.path}`);
  console.log(`\nBranches (${repo.branches.length}):`);
  repo.branches.forEach((branch) => {
    const trunkMarker = branch.isTrunk ? ' (TRUNK)' : '';
    console.log(`  - ${branch.ref}${trunkMarker}`);
  });
}
