import type { GenerationStrategy } from '../types';
import { contextBorderStrategy } from './context-border';
import { independentStrategy } from './independent';

export const strategies: readonly GenerationStrategy[] = [
  independentStrategy,
  contextBorderStrategy,
];

export function getStrategy(name: string): GenerationStrategy | undefined {
  return strategies.find((s) => s.name === name);
}

export { contextBorderStrategy, independentStrategy };
