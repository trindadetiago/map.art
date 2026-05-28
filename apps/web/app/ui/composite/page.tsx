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
            slug: 'joao-pessoa',
            name: 'João Pessoa centro',
            status: 'active',
            centerLat: -7.115,
            centerLng: -34.861,
            cameraPitch: 30,
            cameraYaw: 45,
            tileCount: 256,
            createdAt: new Date('2026-05-01'),
          }}
          deleteAction={async () => {}}
        />
      </div>
    </div>
  );
}
