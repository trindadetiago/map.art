'use client';

import { ProjectCard } from '@/components/admin/projects/project_card';
import { PageHeader } from '../_components/spec';

export default function CompositePage() {
  return (
    <div>
      <PageHeader title="Composite" description="@/components/admin/projects · ProjectCard." />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <ProjectCard
          project={{
            id: 'demo',
            name: 'João Pessoa centro',
            description: 'Pixel-art map of the city center.',
            year: 2024,
            createdAt: new Date('2026-05-01'),
          }}
          deleteAction={async () => {}}
          updateAction={async () => ({ ok: true })}
        />
      </div>
    </div>
  );
}
