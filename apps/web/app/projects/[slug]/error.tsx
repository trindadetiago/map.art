'use client';

export default function ProjectError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4">
      <p className="text-sm text-red-400">Failed to load project</p>
      <button
        type="button"
        onClick={reset}
        className="rounded bg-neutral-800 px-3 py-1 text-xs text-neutral-300 hover:bg-neutral-700"
      >
        Try again
      </button>
    </div>
  );
}
