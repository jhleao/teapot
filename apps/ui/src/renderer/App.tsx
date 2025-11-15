import { useEffect, useState } from 'react'
import type { Repo } from '@teapot/contract'

function App(): React.JSX.Element {
  const [repo, setRepo] = useState<Repo | null>(null)

  useEffect(() => {
    window.api.getRepo().then(setRepo)
  }, [])

  return (
    <div>
      <div className="mt-4 p-4 bg-white rounded shadow">
        <h2 className="text-xl font-bold mb-2">Repo Data:</h2>
        <pre className="text-sm overflow-auto">
          {repo ? JSON.stringify(repo, null, 2) : 'Loading...'}
        </pre>
      </div>
    </div>
  )
}

export default App
