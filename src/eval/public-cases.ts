export type PublicCaseAction = Readonly<Record<string, unknown>> & {
  readonly action: string;
};

export type PublicCaseProtectedValue = {
  readonly kind: string;
  readonly value: string;
};

export type PublicCaseExpected = {
  readonly acceptable: readonly {
    readonly actions: readonly PublicCaseAction[];
  }[];
};

export type PublicCase = {
  readonly id: string;
  readonly problem_id: string;
  readonly reference_time: string;
  readonly protected: readonly PublicCaseProtectedValue[];
  readonly expected: PublicCaseExpected;
};

export type PublicCaseCatalog = {
  readonly cases: readonly PublicCase[];
  readonly byProblemId: ReadonlyMap<string, readonly PublicCase[]>;
};

export type FixtureCoverageReport = {
  readonly fixtureIds: readonly string[];
  readonly recognizedFixtureIds: readonly string[];
  readonly duplicateFixtureIds: readonly string[];
  readonly unknownFixtureIds: readonly string[];
  readonly missingCaseIds: readonly string[];
  readonly complete: boolean;
};

export const PUBLIC_CASES_URL = new URL(
  "../../task/public-cases.json",
  import.meta.url,
);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireRecord(
  value: unknown,
  description: string,
): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new TypeError(`${description} must be an object`);
  }
  return value;
}

function requireString(value: unknown, description: string): string {
  if (typeof value !== "string") {
    throw new TypeError(`${description} must be a string`);
  }
  return value;
}

function parseAction(value: unknown, description: string): PublicCaseAction {
  const action = requireRecord(value, description);
  requireString(action.action, `${description}.action`);
  return action as PublicCaseAction;
}

function parsePublicCase(value: unknown, index: number): PublicCase {
  const description = `cases[${index}]`;
  const item = requireRecord(value, description);
  const expected = requireRecord(item.expected, `${description}.expected`);

  if (!Array.isArray(expected.acceptable)) {
    throw new TypeError(`${description}.expected.acceptable must be an array`);
  }
  if (!Array.isArray(item.protected)) {
    throw new TypeError(`${description}.protected must be an array`);
  }

  return {
    id: requireString(item.id, `${description}.id`),
    problem_id: requireString(item.problem_id, `${description}.problem_id`),
    reference_time: requireString(
      item.reference_time,
      `${description}.reference_time`,
    ),
    protected: item.protected.map((entry, protectedIndex) => {
      const protectedValue = requireRecord(
        entry,
        `${description}.protected[${protectedIndex}]`,
      );
      return {
        kind: requireString(
          protectedValue.kind,
          `${description}.protected[${protectedIndex}].kind`,
        ),
        value: requireString(
          protectedValue.value,
          `${description}.protected[${protectedIndex}].value`,
        ),
      };
    }),
    expected: {
      acceptable: expected.acceptable.map((entry, acceptableIndex) => {
        const acceptable = requireRecord(
          entry,
          `${description}.expected.acceptable[${acceptableIndex}]`,
        );
        if (!Array.isArray(acceptable.actions)) {
          throw new TypeError(
            `${description}.expected.acceptable[${acceptableIndex}].actions must be an array`,
          );
        }
        return {
          actions: acceptable.actions.map((action, actionIndex) =>
            parseAction(
              action,
              `${description}.expected.acceptable[${acceptableIndex}].actions[${actionIndex}]`,
            ),
          ),
        };
      }),
    },
  };
}

export function createPublicCaseCatalog(
  cases: readonly PublicCase[],
): PublicCaseCatalog {
  const seenIds = new Set<string>();
  const grouped = new Map<string, PublicCase[]>();

  for (const item of cases) {
    if (seenIds.has(item.id)) {
      throw new Error(`Duplicate public case ID: ${item.id}`);
    }
    seenIds.add(item.id);

    const problemCases = grouped.get(item.problem_id);
    if (problemCases) {
      problemCases.push(item);
    } else {
      grouped.set(item.problem_id, [item]);
    }
  }

  return {
    cases,
    byProblemId: grouped,
  };
}

export async function loadPublicCases(
  source: string | URL = PUBLIC_CASES_URL,
): Promise<PublicCaseCatalog> {
  const data = requireRecord(
    await Bun.file(source).json(),
    "public-cases.json",
  );
  if (!Array.isArray(data.cases)) {
    throw new TypeError("public-cases.json.cases must be an array");
  }

  return createPublicCaseCatalog(data.cases.map(parsePublicCase));
}

export function createFixtureCoverageReport(
  catalog: PublicCaseCatalog,
  fixtureIds: Iterable<string>,
): FixtureCoverageReport {
  const publicCaseIds = new Set(catalog.cases.map(({ id }) => id));
  const seenFixtureIds = new Set<string>();
  const duplicates = new Set<string>();
  const unknown = new Set<string>();
  const recognized: string[] = [];
  const ids = Array.from(fixtureIds);

  for (const id of ids) {
    if (seenFixtureIds.has(id)) {
      duplicates.add(id);
      continue;
    }
    seenFixtureIds.add(id);

    if (publicCaseIds.has(id)) {
      recognized.push(id);
    } else {
      unknown.add(id);
    }
  }

  const missingCaseIds = catalog.cases
    .filter(({ id }) => !seenFixtureIds.has(id))
    .map(({ id }) => id);
  const duplicateFixtureIds = Array.from(duplicates);
  const unknownFixtureIds = Array.from(unknown);

  return {
    fixtureIds: ids,
    recognizedFixtureIds: recognized,
    duplicateFixtureIds,
    unknownFixtureIds,
    missingCaseIds,
    complete:
      duplicateFixtureIds.length === 0 &&
      unknownFixtureIds.length === 0 &&
      missingCaseIds.length === 0,
  };
}
