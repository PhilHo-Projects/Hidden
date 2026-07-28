import type { PowerupKey, PowerupState } from '../game/types'

interface PowerupTrayProps {
  powerups: PowerupState
  disabled: boolean
  onUse: (powerup: PowerupKey) => void
}

const powerupArt: Record<PowerupKey, string> = {
  shield: '/assets/shield.png',
  reveal: '/assets/binoculars.png',
  extraTurn: '/assets/play-button.png',
}

const powerupLabels: Record<PowerupKey, string> = {
  shield: 'Immune',
  reveal: 'Reveal',
  extraTurn: 'Play again',
}

export function PowerupTray({ powerups, disabled, onUse }: PowerupTrayProps) {
  const items = Object.keys(powerupLabels) as PowerupKey[]

  return (
    <section className="powerup-rail" aria-label="Powerups">
      <div className="powerup-stack">
        {items.map((powerup) => {
          const unlocked = powerups.unlocked[powerup]
          const used = powerups.used[powerup]
          const active =
            powerup === 'reveal'
              ? powerups.revealActive
              : powerup === 'extraTurn'
                ? powerups.extraTurnArmed
                : powerups.used.shield && !powerups.unlocked.shield

          return (
            <button
              key={powerup}
              type="button"
              onClick={() => onUse(powerup)}
              disabled={disabled || !unlocked || used}
              className={`powerup-button ${unlocked && !used ? 'powerup-unlocked' : ''} ${
                active ? 'powerup-active' : ''
              } ${disabled || !unlocked || used ? 'powerup-dimmed' : ''}`}
            >
              <img src={powerupArt[powerup]} alt="" />
              <span>{powerupLabels[powerup]}</span>
              <small>{used ? 'Spent' : active ? 'Armed' : unlocked ? 'Ready' : 'Locked'}</small>
            </button>
          )
        })}
      </div>
    </section>
  )
}
