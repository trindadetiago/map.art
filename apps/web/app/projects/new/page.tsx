import { env } from '@mapart/env';
import { CreateProjectFlow } from './create_flow';

export const dynamic = 'force-dynamic';

export default function NewProjectPage() {
  const apiKey = env.googleMapsApiKey ?? '';

  if (!apiKey) {
    return (
      <div className="rounded-2xl border border-dashed border-stone-300 bg-white/40 p-12 text-center">
        <div className="text-[15px] font-medium text-stone-700">GOOGLE_MAPS_API_KEY not set</div>
        <p className="mx-auto mt-2 mb-0 max-w-[48ch] text-sm text-stone-500">
          The area picker needs a Google Maps key with the Maps JavaScript API and Places API
          enabled. Add <code>GOOGLE_MAPS_API_KEY</code> to your <code>.env</code> and reload.
        </p>
      </div>
    );
  }

  return <CreateProjectFlow apiKey={apiKey} />;
}
