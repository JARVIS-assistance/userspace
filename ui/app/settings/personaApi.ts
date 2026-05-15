import { resolveApiBase } from "./storage";
import type { Persona } from "./types";

type HeadersFactory = () => Record<string, string>;

interface PersonaPayload {
    name: string;
    description: string;
    prompt_template: string;
    tone: string;
    alias: string;
}

function personaPayload(persona: Persona): PersonaPayload {
    return {
        name: persona.name.trim(),
        description: persona.description.trim(),
        prompt_template: persona.prompt_template.trim(),
        tone: persona.tone.trim(),
        alias: persona.alias.trim(),
    };
}

async function readJson(res: Response): Promise<any> {
    try {
        return await res.json();
    } catch (_) {
        return null;
    }
}

function normalizePersona(raw: any, fallback?: Persona): Persona | null {
    if (!raw || typeof raw !== "object") return null;
    const id = raw.user_persona_id ?? raw.id;
    return {
        user_persona_id:
            typeof id === "string" ? id : fallback?.user_persona_id,
        icon:
            typeof raw.icon === "string"
                ? raw.icon
                : (fallback?.icon ?? "\u{1F916}"),
        name: typeof raw.name === "string" ? raw.name : (fallback?.name ?? ""),
        description:
            typeof raw.description === "string"
                ? raw.description
                : (fallback?.description ?? ""),
        prompt_template:
            typeof raw.prompt_template === "string"
                ? raw.prompt_template
                : (fallback?.prompt_template ?? ""),
        tone: typeof raw.tone === "string" ? raw.tone : (fallback?.tone ?? ""),
        alias:
            typeof raw.alias === "string" ? raw.alias : (fallback?.alias ?? ""),
        selected: Boolean(raw.selected ?? raw.is_selected ?? fallback?.selected),
    };
}

function extractPersonas(raw: any): Persona[] {
    const source = Array.isArray(raw)
        ? raw
        : Array.isArray(raw?.personas)
          ? raw.personas
          : Array.isArray(raw?.items)
            ? raw.items
            : Array.isArray(raw?.data)
              ? raw.data
              : raw?.selected_persona
                ? [raw.selected_persona]
                : raw
                  ? [raw]
                  : [];

    return source
        .map(normalizePersona)
        .filter((item: Persona | null): item is Persona => item !== null);
}

export async function fetchPersonas(
    headers: HeadersFactory,
): Promise<Persona[] | null> {
    const apiBase = await resolveApiBase();
    const res = await fetch(`${apiBase}/chat/persona`, {
        headers: headers(),
    });
    if (!res.ok) return null;
    return extractPersonas(await readJson(res));
}

export async function savePersona(
    persona: Persona,
    headers: HeadersFactory,
): Promise<Persona | null> {
    const apiBase = await resolveApiBase();
    const isNew = !persona.user_persona_id;
    const res = await fetch(
        isNew
            ? `${apiBase}/chat/persona`
            : `${apiBase}/chat/persona/${persona.user_persona_id}`,
        {
            method: isNew ? "POST" : "PUT",
            headers: headers(),
            body: JSON.stringify(personaPayload(persona)),
        },
    );
    if (!res.ok) return null;

    const saved = normalizePersona(await readJson(res), persona) ?? persona;
    const userPersonaId = saved.user_persona_id ?? persona.user_persona_id;
    if (!userPersonaId) return saved;

    const selected = await selectPersona(userPersonaId, headers);
    if (!selected) return null;
    return {
        ...persona,
        ...saved,
        user_persona_id: userPersonaId,
        selected: true,
    };
}

export async function selectPersona(
    userPersonaId: string,
    headers: HeadersFactory,
): Promise<boolean> {
    const apiBase = await resolveApiBase();
    const res = await fetch(`${apiBase}/chat/persona/select`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ user_persona_id: userPersonaId }),
    });
    return res.ok;
}
