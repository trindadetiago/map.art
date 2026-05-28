'use client';

import { Select, type SelectOption } from '@/components/admin/select';
import { useState } from 'react';
import { PageHeader, Spec } from '../_components/spec';

const SELECT_OPTIONS: readonly SelectOption<string>[] = [
  { value: 'gpt-image-1.5', label: 'gpt-image-1.5', description: 'fast, cheaper edits' },
  { value: 'gpt-image-2', label: 'gpt-image-2', description: 'higher fidelity' },
  { value: 'qwen', label: 'qwen-image-edit', description: 'local fine-tune target' },
];

export default function FormsPage() {
  const [model, setModel] = useState('gpt-image-1.5');

  return (
    <div>
      <PageHeader
        title="Form controls"
        description="Inputs, number fields, and the Radix-backed Select."
      />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Spec name="Text input">
          <label className="flex flex-col gap-1.5">
            <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-stone-500">
              name
            </span>
            <input
              placeholder="my project"
              className="h-9 w-full rounded-lg border border-stone-200 bg-white px-3 text-[13px] text-stone-900 outline-none transition focus:border-stone-400"
            />
          </label>
        </Spec>
        <Spec name="Number field">
          <label className="flex flex-col gap-1.5">
            <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-stone-500">
              pitch°
            </span>
            <input
              type="number"
              defaultValue={30}
              className="h-9 w-full rounded-lg border border-stone-200 bg-white px-3 text-[13px] text-stone-900 outline-none transition focus:border-stone-400"
            />
          </label>
        </Spec>
        <Spec name="Select (Radix)">
          <Select label="model" value={model} onValueChange={setModel} options={SELECT_OPTIONS} />
        </Spec>
      </div>
    </div>
  );
}
