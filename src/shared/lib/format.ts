const dateFormat = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
});

const numberFormat = new Intl.NumberFormat("en-US");

export function formatDate(value: string | null) {
  return value ? dateFormat.format(new Date(value)) : "Never";
}

export function formatScore(value: number) {
  return value.toFixed(3);
}

export function formatNumber(value: number) {
  return numberFormat.format(value);
}

export function formatSeconds(ms: number) {
  return `${(ms / 1000).toFixed(1)}s`;
}
