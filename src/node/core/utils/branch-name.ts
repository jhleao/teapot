export function generateRandomBranchName(username: string): string {
  const randomCode = Math.random().toString(36).substring(2, 10)
  const sanitizedUsername = username
    .trim()
    .replace(/[^a-zA-Z0-9]/g, '-')
    .toLowerCase()
  return `${sanitizedUsername}-${randomCode}`
}
