export function JsonBlock({ data }: { data: unknown }) {
  return (
    <pre className="overflow-auto rounded-lg bg-secondary/60 p-3 text-xs leading-relaxed text-secondary-foreground">
      <code>{JSON.stringify(data, null, 2)}</code>
    </pre>
  );
}