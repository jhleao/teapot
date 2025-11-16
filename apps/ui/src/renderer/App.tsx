import { useEffect, useState } from 'react'
import type { UiStack as StackType } from '@teapot/contract'
import { StackView } from './components/StackView'

function App(): React.JSX.Element {
  const [stack, setStack] = useState<StackType | null>(null)
  const [isDark, setIsDark] = useState(true)

  useEffect(() => {
    window.api.getRepo().then(setStack)
  }, [])

  useEffect(() => {
    const html = document.documentElement
    if (isDark) html.classList.add('dark')
    else html.classList.remove('dark')
  }, [isDark])

  console.log(stack)

  return (
    <div className="p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Git Stack</h1>
        <button
          onClick={() => setIsDark(!isDark)}
          className="relative inline-flex h-6 w-11 items-center rounded-full bg-muted transition-colors focus:outline-none focus:ring-2 focus:ring-foreground focus:ring-offset-2"
          role="switch"
          aria-checked={isDark}
          aria-label="Toggle dark mode"
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-card-foreground transition-transform ${
              isDark ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </button>
      </div>
      <div className="">
        {stack ? (
          <StackView data={stack} />
        ) : (
          <div className="text-muted-foreground">Loading...</div>
        )}
      </div>
    </div>
  )
}

export default App
