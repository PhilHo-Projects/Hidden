import type { CSSProperties } from 'react'
import './cartoon-burst.css'

interface CartoonBurstProps {
  className?: string
}

const sparks = [
  { x: '-3.4rem', y: '-1.9rem', rotate: '-62deg', delay: '0ms' },
  { x: '-1.3rem', y: '-3.5rem', rotate: '-20deg', delay: '18ms' },
  { x: '1.6rem', y: '-3.25rem', rotate: '24deg', delay: '34ms' },
  { x: '3.55rem', y: '-1.05rem', rotate: '72deg', delay: '8ms' },
  { x: '3.1rem', y: '2.1rem', rotate: '122deg', delay: '42ms' },
  { x: '0.9rem', y: '3.55rem', rotate: '164deg', delay: '22ms' },
  { x: '-2rem', y: '3.15rem', rotate: '208deg', delay: '48ms' },
  { x: '-3.65rem', y: '0.7rem', rotate: '258deg', delay: '14ms' },
] as const

export function CartoonBurst({ className = '' }: CartoonBurstProps) {
  return (
    <span className={`cartoon-burst ${className}`.trim()} aria-hidden="true">
      <span className="cartoon-burst__flash" />
      <span className="cartoon-burst__star cartoon-burst__star--outer" />
      <span className="cartoon-burst__star cartoon-burst__star--inner" />
      <span className="cartoon-burst__core" />
      <span className="cartoon-burst__ring" />
      {sparks.map((spark, index) => (
        <span
          key={index}
          className="cartoon-burst__spark"
          style={
            {
              '--burst-x': spark.x,
              '--burst-y': spark.y,
              '--burst-rotate': spark.rotate,
              '--burst-delay': spark.delay,
            } as CSSProperties
          }
        />
      ))}
    </span>
  )
}
