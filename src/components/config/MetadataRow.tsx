interface MetadataRowProps {
  label: string
  value: string
  valueClassName?: string
}

export default function MetadataRow({ label, value, valueClassName = 'text-slate-200' }: MetadataRowProps): JSX.Element {
  return (
    <div className="flex justify-between gap-4 py-1">
      <span className="text-slate-500">{label}</span>
      <span className={`text-right ${valueClassName}`}>{value}</span>
    </div>
  )
}
