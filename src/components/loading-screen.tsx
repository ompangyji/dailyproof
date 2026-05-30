/**
 * Full-page loading indicator used by route-level loading.tsx files
 * so users see immediate feedback during server-rendered navigation
 * instead of staring at a frozen page.
 */
export function LoadingScreen({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="card-brut px-7 py-6 flex items-center gap-4">
        <span className="brut-spinner brut-spinner-lg" aria-hidden />
        <span className="font-display text-2xl">{label}</span>
      </div>
    </div>
  );
}
