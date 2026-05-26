'use client';

import * as RxSelect from '@radix-ui/react-select';
import type { ReactNode } from 'react';
import { IconCheck, IconChevronDown } from './icons';

export interface SelectOption<T extends string> {
  value: T;
  label: string;
  description?: string;
}

export interface SelectProps<T extends string> {
  value: T;
  onValueChange: (value: T) => void;
  options: readonly SelectOption<T>[];
  placeholder?: string;
  /** Display label rendered above the trigger. Optional. */
  label?: string;
  /** Trigger width override. Defaults to 100% of parent. */
  triggerClassName?: string;
  disabled?: boolean;
}

/**
 * Base dropdown for admin surfaces. Styled wrapper around Radix's headless
 * Select primitive — keyboard, ARIA, portal, focus management all handled.
 */
export function Select<T extends string>({
  value,
  onValueChange,
  options,
  placeholder = 'Select…',
  label,
  triggerClassName = '',
  disabled,
}: SelectProps<T>) {
  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-stone-500">
          {label}
        </span>
      )}
      <RxSelect.Root
        value={value}
        onValueChange={(v) => onValueChange(v as T)}
        {...(disabled !== undefined ? { disabled } : {})}
      >
        <RxSelect.Trigger
          className={`group inline-flex h-9 w-full items-center justify-between gap-2 rounded-lg border border-stone-200 bg-white px-3 text-left text-[13px] text-stone-900 outline-none transition hover:border-stone-300 focus:border-stone-400 disabled:cursor-not-allowed disabled:opacity-50 data-[state=open]:border-stone-400 ${triggerClassName}`}
        >
          <RxSelect.Value placeholder={placeholder} />
          <RxSelect.Icon className="text-stone-400 transition group-data-[state=open]:rotate-180">
            <IconChevronDown className="h-4 w-4" />
          </RxSelect.Icon>
        </RxSelect.Trigger>
        <RxSelect.Portal>
          <RxSelect.Content
            position="popper"
            sideOffset={4}
            className="z-50 min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-lg border border-stone-200 bg-white p-1 shadow-lg"
          >
            <RxSelect.Viewport className="p-0">
              {options.map((opt) => (
                <SelectOptionRow key={opt.value} option={opt} />
              ))}
            </RxSelect.Viewport>
          </RxSelect.Content>
        </RxSelect.Portal>
      </RxSelect.Root>
    </div>
  );
}

function SelectOptionRow<T extends string>({ option }: { option: SelectOption<T> }) {
  return (
    <RxSelect.Item
      value={option.value}
      className="group relative flex cursor-pointer flex-col rounded-md px-2.5 py-1.5 text-[13px] text-stone-700 outline-none transition data-[highlighted]:bg-stone-100 data-[state=checked]:bg-stone-900 data-[state=checked]:text-white"
    >
      <div className="flex items-center justify-between gap-3">
        <RxSelect.ItemText>{option.label}</RxSelect.ItemText>
        <RxSelect.ItemIndicator>
          <IconCheck className="h-3.5 w-3.5" />
        </RxSelect.ItemIndicator>
      </div>
      {option.description && (
        <span className="mt-0.5 text-[11px] text-stone-500 group-data-[state=checked]:text-white/70">
          {option.description}
        </span>
      )}
    </RxSelect.Item>
  );
}

/** A re-export so callers can drop a label into label-less <Select>s when needed. */
export function SelectLabel({ children }: { children: ReactNode }) {
  return (
    <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-stone-500">
      {children}
    </span>
  );
}
