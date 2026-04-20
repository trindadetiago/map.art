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
      id: 'stub',
      kind: 'edit',
      endpoint: 'local://stub',
      notes: 'Pixelate + hue-shift. Local only, no API.',
      active: false,
    },
    {
      id: 'nano-banana',
      kind: 'edit',
      endpoint: 'gemini:gemini-2.5-flash-image',
      notes: 'Gemini 2.5 Flash Image — cheap/fast, conservative edits.',
      active: false,
    },
    {
      id: 'nano-banana-pro',
      kind: 'edit',
      endpoint: 'gemini:gemini-3-pro-image-preview',
      notes: 'Gemini 3 Pro Image — stronger stylization, what Cannon Eyed used.',
      active: true,
    },
    {
      id: 'gemini-3.1-flash-image',
      kind: 'edit',
      endpoint: 'gemini:gemini-3.1-flash-image-preview',
      notes: 'Newer Flash variant — speed/quality sweet spot.',
      active: false,
    },
  ];
  for (const m of defaults) {
    await upsertModel(m);
  }
  return defaults.length;
}
