import { useEffect, useState } from 'react'
import { PUBLIC_CONFIG_URL } from '../config/publicApi'

export interface GasPricesPublic {
  avgasPrice: number | null
  ul91Price: number | null
  jetA1Price: number | null
  currency: string
}

interface GasPricesPanelProps {
  // Same override pattern as RightInfoPanel.tsx's own opsPanelData prop -
  // an authenticated admin preview (Screens Design) may have its session
  // switched to a different org than whatever subdomain it's actually
  // rendering on, so a bare self-fetch there would risk showing another
  // tenant's real prices. Every real public-dashboard caller omits this
  // and self-fetches PUBLIC_CONFIG_URL instead, same as that file.
  gasPricesData?: GasPricesPublic | null
  // Pilot View passes this true - PilotCollapsibleSection already
  // renders its own "Fuel Prices" title as the accordion header, so
  // this component's own internal one would show twice. Defaults false
  // (render it) - every existing caller (Clubhouse1Template.tsx etc.)
  // omits this prop entirely and is completely unaffected.
  hideTitle?: boolean
  // Same opt-in-prop precedent as hideTitle above - Pilot View's font-
  // size round bumps the tile labels/prices for phone readability without
  // touching this component's own defaults, which every existing TV-
  // dashboard caller still renders unchanged.
  largeText?: boolean
}

// Simple hand-rolled droplet - this repo has no icon library (see
// PasswordField.tsx's own comment on that), so every icon here is an
// inline SVG, same convention as CompassPanel.tsx/RunwayGroupGraphic.
function FuelDropletIcon({ className }: { className?: string }): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <path d="M12 2.5C12 2.5 5.5 11 5.5 15.5a6.5 6.5 0 0 0 13 0C18.5 11 12 2.5 12 2.5z" />
    </svg>
  )
}

interface Tile {
  key: string
  label: string
  price: number
}

// Compact tiles, not a second tall card (task #42) - small icon, small
// uppercase label, large bold value with the currency prefixed, same
// "small label + bold value" idiom CompassPanel.tsx's ReadoutRow already
// established for this dashboard (Wind/Headwind/Crosswind), just laid
// out as a tight horizontal row of self-contained tiles instead of a
// label/value grid, since three independent prices read better as
// separate at-a-glance chips than as one shared table.
export default function GasPricesPanel({ gasPricesData, hideTitle = false, largeText = false }: GasPricesPanelProps = {}): JSX.Element | null {
  const [gasPrices, setGasPrices] = useState<GasPricesPublic | null>(gasPricesData ?? null)

  useEffect(() => {
    if (gasPricesData !== undefined) {
      setGasPrices(gasPricesData)
      return
    }
    let cancelled = false
    fetch(PUBLIC_CONFIG_URL)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!cancelled) setGasPrices(data?.gasPrices ?? null)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [gasPricesData])

  if (!gasPrices) return null

  // Same "nothing rendered while genuinely empty" posture as
  // RightInfoPanel.tsx's own auto-NOTAMs section - a tenant that's never
  // touched Dashboard Manager's Gas Prices container shows no container
  // at all here, not three empty/zero tiles, and the Ops Panel column
  // below simply reclaims that space (see Clubhouse1Template.tsx's own
  // right-column comment).
  const tiles: Tile[] = [
    gasPrices.avgasPrice !== null ? { key: 'avgas', label: 'AVGAS', price: gasPrices.avgasPrice } : null,
    gasPrices.ul91Price !== null ? { key: 'ul91', label: 'UL91', price: gasPrices.ul91Price } : null,
    gasPrices.jetA1Price !== null ? { key: 'jetA1', label: 'JET A1', price: gasPrices.jetA1Price } : null,
  ].filter((tile): tile is Tile => tile !== null)

  if (tiles.length === 0) return null

  return (
    <div className="flex-shrink-0 rounded-3xl border border-border bg-panel p-4 shadow-xl shadow-slate-950/20">
      {!hideTitle && (
        <div className="mb-3 text-center text-xs font-semibold uppercase tracking-[0.25em] text-muted-400">Fuel Prices</div>
      )}
      <div className="flex gap-2">
        {tiles.map((tile) => (
          <div key={tile.key} className="flex flex-1 flex-col items-center gap-1 rounded-xl border border-border bg-card px-2 py-2.5">
            <FuelDropletIcon className="h-4 w-4 text-accent-sky-400" />
            <div className={`font-semibold uppercase tracking-wide text-muted-500 ${largeText ? 'text-base' : 'text-[10px]'}`}>{tile.label}</div>
            <div className={`font-extrabold leading-none text-primary ${largeText ? 'text-2xl' : 'text-xl'}`}>
              {gasPrices.currency}
              {tile.price.toFixed(2)}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
