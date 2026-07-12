/** GET /api/catalog — provider presets for the "Add provider" form. */
import { CATALOG } from "@/core/catalog";

export async function GET() {
  return Response.json(
    CATALOG.map(({ id, label, keyless, keyHint, baseUrl, docsUrl }) => ({
      id,
      label,
      keyless: !!keyless,
      keyHint: keyHint ?? null,
      baseUrl,
      docsUrl,
    })),
  );
}
