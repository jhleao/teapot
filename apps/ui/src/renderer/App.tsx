import { useEffect, useState } from 'react'
import type { Stack } from '@teapot/contract'

function App(): React.JSX.Element {
  const [stack, setStack] = useState<Stack | null>(null)

  useEffect(() => {
    window.api.getRepo().then(setStack)
  }, [])

  return (
    <div>
      <div className="mt-4 p-4 bg-white rounded shadow">
        <h2 className="text-xl font-bold mb-2">Repo Data:</h2>
        <pre className="text-sm overflow-auto">
          {stack ? JSON.stringify(stack, null, 2) : 'Loading...'}
        </pre>
      </div>
    </div>
  )
}

export default App
