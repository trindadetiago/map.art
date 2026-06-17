'use client';

import { Select } from '@/components/admin/select';
import { useRouter } from 'next/navigation';

/** Project dropdown that drives the page's `?project=` param. Selection lives in
 * the URL so the editor is server-rendered per project (pins + map centre). */
export function ProjectPicker({
  projects,
  selected,
}: {
  projects: { id: string; name: string }[];
  selected: string | null;
}) {
  const router = useRouter();

  if (projects.length === 0) {
    return <p className="m-0 text-sm text-stone-500">No projects yet. Create one first.</p>;
  }

  return (
    <Select
      label="project"
      value={selected ?? ''}
      placeholder="Select a project…"
      onValueChange={(id) => router.push(`/admin/pins?project=${id}`)}
      options={projects.map((p) => ({ value: p.id, label: p.name }))}
    />
  );
}
