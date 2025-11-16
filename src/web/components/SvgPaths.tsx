import React from 'react'
import { cn } from '../utils/cn'

export function SineCurve({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg
      className={cn('text-border relative bottom-0 mb-0', className)}
      width="22"
      height="32"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M21 0C 21 22, 0 7, 1 32"
        strokeWidth="2px"
        stroke="currentColor"
        fill="transparent"
      ></path>
    </svg>
  )
}

export function CommitDot({
  top = false,
  bottom = false,
  variant = 'default',
  accentLines = 'none',
  onMouseDown,
  className
}: {
  top?: boolean
  bottom?: boolean
  variant?: 'default' | 'accent' | 'current'
  accentLines?: 'none' | 'top' | 'bottom' | 'both'
  onMouseDown?: () => void
  className?: string
}): React.JSX.Element {
  // Determine connector visibility
  const showTopLine = top
  const showBottomLine = bottom

  // Determine stroke classes for connectors
  const topStrokeClass =
    accentLines === 'top' || accentLines === 'both' ? 'stroke-accent' : 'stroke-border'
  const bottomStrokeClass =
    accentLines === 'bottom' || accentLines === 'both' ? 'stroke-accent' : 'stroke-border'

  // Determine circle styling
  const isCurrent = variant === 'current'
  const circleStrokeClass = variant === 'default' ? 'stroke-border' : 'stroke-accent'
  const circleRadius = isCurrent ? 6 : 4
  const circleStrokeWidth = isCurrent ? 3 : 2

  return (
    <svg
      width="24px"
      height="36"
      xmlns="http://www.w3.org/2000/svg"
      onMouseDown={onMouseDown}
      className={cn('text-border', onMouseDown && 'cursor-grab', className)}
    >
      {showTopLine && (
        <path
          d="M12,0 L12,15"
          strokeWidth="2px"
          className={cn(topStrokeClass)}
          fill="transparent"
        ></path>
      )}
      {showBottomLine && (
        <path
          d="M12,22 L12,36"
          strokeWidth="2px"
          className={cn(bottomStrokeClass)}
          strokeDasharray="0"
          fill="transparent"
        ></path>
      )}
      <circle
        cx="12"
        cy="18"
        r={circleRadius.toString()}
        strokeWidth={circleStrokeWidth.toString()}
        stroke="currentColor"
        strokeDasharray="0"
        className={cn(circleStrokeClass)}
      ></circle>
    </svg>
  )
}
