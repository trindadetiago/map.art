import { asc, eq } from 'drizzle-orm';
import { getDb } from '../client';
import { type Model, type NewModel, models } from '../schema/models';

export async function listModels(): Promise<Model[]> {
  return getDb().select().from(models).orderBy(asc(models.id));
}

export async function getModelById(id: string): Promise<Model | undefined> {
  const rows = await getDb().select().from(models).where(eq(models.id, id)).limit(1);
  return rows[0];
}

export async function upsertModel(input: NewModel): Promise<Model> {
  const [row] = await getDb()
    .insert(models)
    .values(input)
    .onConflictDoUpdate({
      target: models.id,
      set: {
        kind: input.kind,
        endpoint: input.endpoint,
        config: input.config ?? {},
        notes: input.notes ?? null,
        active: input.active ?? false,
      },
    })
    .returning();
  if (!row) throw new Error('upsertModel: insert returned no row');
  return row;
}

export async function seedDefaultModels(): Promise<number> {
  const defaults: NewModel[] = [
    {
      id: 'gpt-image-1.5',
      kind: 'edit',
      endpoint: 'openai:gpt-image-1.5',
      notes: 'OpenAI gpt-image-1.5, supports masked edits (infill).',
      active: true,
    },
    {
      id: 'gpt-image-2',
      kind: 'edit',
      endpoint: 'openai:gpt-image-2',
      notes: 'OpenAI gpt-image-2, supports masked edits (infill).',
      active: false,
    },
  ];
  for (const m of defaults) {
    await upsertModel(m);
  }
  return defaults.length;
}
