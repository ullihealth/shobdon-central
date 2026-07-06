export default function MockWeatherConfigSection(): JSX.Element {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold uppercase tracking-widest text-slate-400">Mock Weather</h3>
      <p className="text-lg text-slate-300">Use simulated weather values.</p>
      <p className="text-base text-slate-500">Intended for development away from the airfield.</p>
    </div>
  )
}
