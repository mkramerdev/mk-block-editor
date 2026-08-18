export interface FirstDraftPerson {
  readonly id: string;
  readonly displayName: string;
  readonly role: string;
  readonly avatarLabel: string;
  readonly keywords: readonly string[];
}

function person(
  id: string,
  displayName: string,
  role: string,
  avatarLabel: string,
  keywords: readonly string[],
): FirstDraftPerson {
  return Object.freeze({
    id,
    displayName,
    role,
    avatarLabel,
    keywords: Object.freeze([...keywords]),
  });
}

export const firstDraftPeople = Object.freeze([
  person("person-001", "Maya Chen", "Product Designer", "MC", [
    "design",
    "product",
    "ux",
  ]),
  person("person-002", "Jonas Weber", "Software Engineer", "JW", [
    "engineering",
    "frontend",
    "software",
  ]),
  person("person-003", "Aisha Rahman", "Research Lead", "AR", [
    "research",
    "insights",
    "leadership",
  ]),
  person("person-004", "Leo Martinez", "Product Manager", "LM", [
    "product",
    "planning",
    "roadmap",
  ]),
  person("person-005", "Nina Petrova", "Data Analyst", "NP", [
    "analytics",
    "data",
    "metrics",
  ]),
  person("person-006", "Sam Okafor", "Customer Success", "SO", [
    "customer",
    "support",
    "success",
  ]),
] as const satisfies readonly FirstDraftPerson[]);

export function readFirstDraftPerson(id: string): FirstDraftPerson | null {
  return firstDraftPeople.find((candidate) => candidate.id === id) ?? null;
}

export function normalizeFirstDraftPersonQuery(query: string): string {
  return query.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();
}

export function filterFirstDraftPeople(query: string): readonly FirstDraftPerson[] {
  const normalizedQuery = normalizeFirstDraftPersonQuery(query);
  if (normalizedQuery.length === 0) return firstDraftPeople;
  return firstDraftPeople
    .map((candidate, catalogIndex) => ({
      candidate,
      catalogIndex,
      score: scorePerson(candidate, normalizedQuery),
    }))
    .filter(({ score }) => score !== null)
    .sort((left, right) =>
      left.score === right.score
        ? left.catalogIndex - right.catalogIndex
        : left.score! - right.score!,
    )
    .map(({ candidate }) => candidate);
}

function scorePerson(personRecord: FirstDraftPerson, query: string): number | null {
  const name = normalizeFirstDraftPersonQuery(personRecord.displayName);
  const role = normalizeFirstDraftPersonQuery(personRecord.role);
  const keywords = personRecord.keywords.map(normalizeFirstDraftPersonQuery);
  if (name === query) return 0;
  if (name.startsWith(query)) return 1;
  if (name.split(" ").some((word) => word.startsWith(query))) return 2;
  if (role.startsWith(query) || keywords.some((keyword) => keyword.startsWith(query))) {
    return 3;
  }
  if (
    role.includes(query) ||
    keywords.some((keyword) => keyword.includes(query)) ||
    name.includes(query)
  ) {
    return 4;
  }
  return null;
}
