import git from 'isomorphic-git';
import fs from 'fs';

export async function getTrunkBranchRef(
  repoPath: string,
  branches: string[]
): Promise<string | null> {
  // Try to infer trunk by reading refs/remotes/origin/HEAD
  try {
    // Read the symbolic ref to find the default branch
    const symbolicRef = await fs.promises.readFile(
      `${repoPath}/.git/refs/remotes/origin/HEAD`,
      'utf8'
    );

    // The symbolic ref will be something like "ref: refs/remotes/origin/main\n"
    // We need to extract just "main"
    const match = symbolicRef.match(/ref:\s*refs\/remotes\/origin\/(.+)/);
    if (match && match[1]) {
      const trunkBranch = match[1].trim();
      console.log(`Inferred trunk branch from origin/HEAD: ${trunkBranch}`);
      return trunkBranch;
    }
  } catch (error) {
    // If we can't read the symbolic ref, fall back to common names
    console.log('Could not infer trunk from origin/HEAD, using fallback');
  }

  // Fallback: Common trunk branch names in order of preference
  const trunkCandidates = ['main', 'master', 'develop'];
  return (
    trunkCandidates.find((name) => branches.includes(name)) ||
    branches[0] ||
    null
  );
}
