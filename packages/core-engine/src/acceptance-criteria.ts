import type {
  TestDesignRequirement,
  TestDesignRequirementVerificationMode,
} from "@oscharko-dev/ti-contracts";

export interface ExtractAcceptanceCriteriaInput {
  markdown: string;
  sourceId: string;
  screenIds?: readonly string[];
  maxCriteria?: number;
}

const DEFAULT_MAX_CRITERIA = 80;
const ACCEPTANCE_HEADING_RE =
  /^(akzeptanzkriterien|akzeptanz kriterium|acceptance criteria|acceptance criterion|acceptance tests?)(?:\s*(?::|[([{/–—-]).*)?$/iu;
const HEADING_RE = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/u;
const LIST_ITEM_RE =
  /^\s{0,6}(?:(?:[-*+]\s+(?:\[[ xX]\]\s+)?)|(?:\d+[.)]\s+))(.*)$/u;
const EXPLICIT_AC_RE = /^\s{0,6}(AC[-_ ]?\d{1,4})\s*[:.)-]\s*(.+)$/iu;
const MARKDOWN_LINK_RE = /\[([^\]]+)\]\([^)]*\)/gu;

export const extractAcceptanceCriteriaFromMarkdown = (
  input: ExtractAcceptanceCriteriaInput,
): TestDesignRequirement[] => {
  const maxCriteria = input.maxCriteria ?? DEFAULT_MAX_CRITERIA;
  const lines = input.markdown
    .normalize("NFKC")
    .replace(/\r\n?/gu, "\n")
    .split("\n");
  const ranges = findAcceptanceCriteriaRanges(lines);
  const texts =
    ranges.length > 0
      ? ranges.flatMap((range) =>
          extractListItems(lines.slice(range.start, range.end)),
        )
      : extractExplicitAcceptanceCriteria(lines);

  const screenId =
    input.screenIds?.length === 1 ? input.screenIds[0] : undefined;
  return texts
    .map(normalizeCriterionText)
    .filter((text) => text.length > 0)
    .filter((text, index, array) => array.indexOf(text) === index)
    .slice(0, maxCriteria)
    .map((text, index) => ({
      requirementId: `AC-${String(index + 1).padStart(3, "0")}`,
      kind: "acceptance_criterion",
      text,
      sourceRefs: [input.sourceId],
      ...(screenId !== undefined ? { screenId } : {}),
      verificationMode: classifyVerificationMode(text),
    }));
};

const findAcceptanceCriteriaRanges = (
  lines: readonly string[],
): Array<{ start: number; end: number }> => {
  const ranges: Array<{ start: number; end: number }> = [];
  for (let index = 0; index < lines.length; index += 1) {
    const heading = HEADING_RE.exec(lines[index] ?? "");
    if (heading === null) continue;
    const level = heading[1]?.length ?? 0;
    const title = normalizeHeading(heading[2] ?? "");
    if (!ACCEPTANCE_HEADING_RE.test(title)) continue;
    let end = lines.length;
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const nextHeading = HEADING_RE.exec(lines[cursor] ?? "");
      if (nextHeading !== null && (nextHeading[1]?.length ?? 0) <= level) {
        end = cursor;
        break;
      }
    }
    ranges.push({ start: index + 1, end });
  }
  return ranges;
};

const extractListItems = (lines: readonly string[]): string[] => {
  const items: string[] = [];
  let current: string[] = [];
  const flush = (): void => {
    const text = current.join(" ").trim();
    if (text.length > 0) items.push(text);
    current = [];
  };
  for (const line of lines) {
    if (HEADING_RE.test(line)) break;
    const explicit = EXPLICIT_AC_RE.exec(line);
    const item = explicit === null ? LIST_ITEM_RE.exec(line) : explicit;
    if (item !== null) {
      flush();
      current.push(item[item.length - 1] ?? "");
      continue;
    }
    if (current.length > 0 && line.trim().length > 0) {
      current.push(line.trim());
    }
  }
  flush();
  return items;
};

const extractExplicitAcceptanceCriteria = (
  lines: readonly string[],
): string[] =>
  lines.flatMap((line) => {
    const match = EXPLICIT_AC_RE.exec(line);
    return match === null ? [] : [match[2] ?? ""];
  });

const normalizeHeading = (value: string): string =>
  value
    .replace(/[*_`~]/gu, "")
    .replace(/\s+/gu, " ")
    .trim()
    .toLowerCase();

const normalizeCriterionText = (value: string): string =>
  value
    .replace(MARKDOWN_LINK_RE, "$1")
    .replace(/[*_~]/gu, "")
    .replace(/`([^`]+)`/gu, "$1")
    .replace(/\s+/gu, " ")
    .trim();

const classifyVerificationMode = (
  text: string,
): TestDesignRequirementVerificationMode => {
  const normalized = text.toLowerCase();
  if (
    /\b(dokumentiert|referenzierbar|definition of done|fachlich finalisiert|klarungsbedarf|klaerungsbedarf)\b/iu.test(
      normalized,
    )
  ) {
    return "manual_review";
  }
  if (
    /\b(wenn|falls|abh[aä]ngig|depends|if|either|one of|aktion|abbrechen|anlegen|speichern|navigation)\b/iu.test(
      normalized,
    )
  ) {
    return "automated";
  }
  if (
    /\b(layout|typografie|spacing|desktop-frame|sichtbar|dargestellt|nachgebildet|visuell|ersichtlich|vorhanden|zeigt|anzeigen|angezeigt)\b/iu.test(
      normalized,
    )
  ) {
    return "visual";
  }
  return "automated";
};
