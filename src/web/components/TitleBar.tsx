import React from 'react'

export function TitleBar(): React.JSX.Element {
  return (
    <div
      className="bg-background/50 sticky top-0 z-50 h-9 w-full backdrop-blur-lg"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    />
  )
}
