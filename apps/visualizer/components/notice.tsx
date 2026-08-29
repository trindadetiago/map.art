/** Inline code styling for identifiers quoted inside a {@link Notice}. */
export const CODE =
  'rounded-md border border-[rgba(234,230,220,0.1)] bg-[#221f17] px-1.5 py-0.5 font-mono text-[12.5px]';

/** Centred message card shown in place of the viewer when there's nothing to show. */
export function Notice({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 flex items-center justify-center p-8">
      <div className="w-full max-w-[520px] rounded-[14px] border border-[rgba(234,230,220,0.12)] bg-[#16140f] px-6 py-[22px]">
        <h1 className="mt-0 mb-2.5 text-[18px] font-semibold">{title}</h1>
        <div className="text-[14px] leading-[1.6] text-[#9a9385]">{children}</div>
      </div>
    </div>
  );
}
