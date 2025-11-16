import { useEffect, useState } from 'react'
import type { UiStack as StackType } from '@teapot/contract'
import { StackView } from './components/StackView'

function App(): React.JSX.Element {
  const [stack, setStack] = useState<StackType | null>(null)

  useEffect(() => {
    window.api.getRepo().then(setStack)
  }, [])

  return (
    <div className="p-6">
      <div className="mb-4">
        <h1 className="text-2xl font-bold">Git Stack</h1>
      </div>
      <div className="bg-white rounded shadow p-4">
        {stack ? <StackView data={stack} /> : <div className="text-gray-500">Loading...</div>}
      </div>
    </div>
  )
}

export default App
