import type {
  CreateElicitationRequest,
  CreateElicitationResponse,
  RequestPermissionRequest,
  RequestPermissionResponse,
} from '@agentclientprotocol/sdk';

import type { PermissionOutcome } from '../message';

export type AskUserQuestionOption = {
  label: string;
  description?: string;
  preview?: string;
};

export type AskUserQuestionSource = 'claude' | 'codex';

export type AskUserQuestion = {
  id?: string;
  question: string;
  header: string;
  options: AskUserQuestionOption[];
  multiSelect: boolean;
  allowCustomAnswer?: boolean;
  isSecret?: boolean;
};

export type AskUserQuestionPermissionMeta = {
  source: AskUserQuestionSource;
  version: number;
  allowCustomAnswer: boolean;
  questions: AskUserQuestion[];
  /** Absolute server-aligned time when the provider will continue without an answer. */
  autoResolveAt?: number;
};

export type AskUserQuestionAnswerValue = string | string[];
export type AskUserQuestionAnswers = Record<string, AskUserQuestionAnswerValue>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const getBooleanField = (
  value: Record<string, unknown>,
  camelCaseKey: string,
  snakeCaseKey: string
): boolean => value[camelCaseKey] === true || value[snakeCaseKey] === true;

const getClaudeCodeMeta = (meta: unknown): Record<string, unknown> | null => {
  if (!isRecord(meta)) return null;
  const claudeCode = meta.claudeCode;
  return isRecord(claudeCode) ? claudeCode : null;
};

const getCodexMeta = (meta: unknown): Record<string, unknown> | null => {
  if (!isRecord(meta)) return null;
  const codex = meta.codex;
  return isRecord(codex) ? codex : null;
};

export function parseAskUserQuestionPermissionMeta(
  meta: unknown
): AskUserQuestionPermissionMeta | null {
  const claudeCode = getClaudeCodeMeta(meta);
  if (claudeCode) {
    return parseClaudeAskUserQuestionPermissionMeta(claudeCode);
  }

  const codex = getCodexMeta(meta);
  if (codex) {
    return parseCodexRequestUserInputPermissionMeta(codex);
  }

  return null;
}

function parseClaudeAskUserQuestionPermissionMeta(
  claudeCode: Record<string, unknown>
): AskUserQuestionPermissionMeta | null {
  const raw = claudeCode.askUserQuestion;
  if (!isRecord(raw)) return null;

  const rawQuestions = raw.questions;
  if (!Array.isArray(rawQuestions) || rawQuestions.length === 0) return null;

  const questions: AskUserQuestion[] = [];
  for (const rawQuestion of rawQuestions) {
    if (!isRecord(rawQuestion)) return null;
    if (typeof rawQuestion.question !== 'string') return null;
    if (typeof rawQuestion.header !== 'string') return null;
    if (!Array.isArray(rawQuestion.options)) return null;

    const options: AskUserQuestionOption[] = [];
    for (const rawOption of rawQuestion.options) {
      if (!isRecord(rawOption)) return null;
      if (typeof rawOption.label !== 'string') return null;
      options.push({
        label: rawOption.label,
        ...(typeof rawOption.description === 'string'
          ? { description: rawOption.description }
          : {}),
        ...(typeof rawOption.preview === 'string' ? { preview: rawOption.preview } : {}),
      });
    }

    questions.push({
      question: rawQuestion.question,
      header: rawQuestion.header,
      options,
      multiSelect: rawQuestion.multiSelect === true,
    });
  }

  return {
    source: 'claude',
    version: typeof raw.version === 'number' && Number.isFinite(raw.version) ? raw.version : 1,
    allowCustomAnswer: raw.allowCustomAnswer === true,
    questions,
  };
}

function parseCodexRequestUserInputPermissionMeta(
  codex: Record<string, unknown>
): AskUserQuestionPermissionMeta | null {
  const raw = codex.requestUserInput;
  if (!isRecord(raw)) return null;

  const rawQuestions = raw.questions;
  if (!Array.isArray(rawQuestions) || rawQuestions.length === 0) return null;

  const questions: AskUserQuestion[] = [];
  for (const rawQuestion of rawQuestions) {
    if (!isRecord(rawQuestion)) return null;
    if (typeof rawQuestion.id !== 'string') return null;
    if (typeof rawQuestion.question !== 'string') return null;
    if (typeof rawQuestion.header !== 'string') return null;

    const rawOptions = rawQuestion.options;
    const options: AskUserQuestionOption[] = [];
    if (rawOptions !== undefined) {
      if (!Array.isArray(rawOptions)) return null;
      for (const rawOption of rawOptions) {
        if (!isRecord(rawOption)) return null;
        if (typeof rawOption.label !== 'string') return null;
        options.push({
          label: rawOption.label,
          ...(typeof rawOption.description === 'string'
            ? { description: rawOption.description }
            : {}),
        });
      }
    }

    questions.push({
      id: rawQuestion.id,
      question: rawQuestion.question,
      header: rawQuestion.header,
      options,
      multiSelect: false,
      allowCustomAnswer:
        getBooleanField(rawQuestion, 'isOther', 'is_other') ||
        rawQuestion.allowCustomAnswer === true,
      isSecret: getBooleanField(rawQuestion, 'isSecret', 'is_secret'),
    });
  }

  return {
    source: 'codex',
    version: 1,
    allowCustomAnswer: questions.some((question) => question.allowCustomAnswer === true),
    questions,
    ...(typeof raw.autoResolveAt === 'number' && Number.isFinite(raw.autoResolveAt)
      ? { autoResolveAt: raw.autoResolveAt }
      : {}),
  };
}

export function isAskUserQuestionPermissionMeta(meta: unknown): boolean {
  return parseAskUserQuestionPermissionMeta(meta) !== null;
}

export function isAskUserQuestionPermissionRequest(request: RequestPermissionRequest): boolean {
  return isAskUserQuestionPermissionMeta((request as { _meta?: unknown })._meta);
}

export function getAskUserQuestionDisplayTitle(meta: unknown): string | undefined {
  const parsed = parseAskUserQuestionPermissionMeta(meta);
  if (!parsed) return undefined;

  for (const question of parsed.questions) {
    const title = question.question.trim() || question.header.trim();
    if (title) return title;
  }
  return undefined;
}

export function getAskUserQuestionPermissionDisplayTitle(
  request: RequestPermissionRequest
): string | undefined {
  return getAskUserQuestionDisplayTitle((request as { _meta?: unknown })._meta);
}

const isUniqueNonEmptyQuestionField = (
  questions: readonly AskUserQuestion[],
  value: string,
  getValue: (question: AskUserQuestion) => string
): boolean =>
  value.trim().length > 0 &&
  questions.filter((question) => getValue(question) === value).length === 1;

export function getAskUserQuestionAnswerKey(
  questions: readonly AskUserQuestion[],
  index: number
): string {
  const question = questions[index];
  if (!question) return String(index);

  if (
    question.id &&
    isUniqueNonEmptyQuestionField(questions, question.id, (item) => item.id ?? '')
  ) {
    return question.id;
  }

  if (isUniqueNonEmptyQuestionField(questions, question.question, (item) => item.question)) {
    return question.question;
  }

  if (isUniqueNonEmptyQuestionField(questions, question.header, (item) => item.header)) {
    return question.header;
  }

  return String(index);
}

const getCodexOutcomeAnswers = (outcomeMeta: unknown): Record<string, unknown> | null => {
  const codex = getCodexMeta(outcomeMeta);
  const requestUserInput =
    codex && isRecord(codex.requestUserInput) ? codex.requestUserInput : null;
  return requestUserInput && isRecord(requestUserInput.answers) ? requestUserInput.answers : null;
};

const getClaudeOutcomeAnswers = (outcomeMeta: unknown): Record<string, unknown> | null => {
  const claudeCode = getClaudeCodeMeta(outcomeMeta);
  const askUserQuestion =
    claudeCode && isRecord(claudeCode.askUserQuestion) ? claudeCode.askUserQuestion : null;
  return askUserQuestion && isRecord(askUserQuestion.answers) ? askUserQuestion.answers : null;
};

export function extractAskUserQuestionAnswersFromOutcome(
  meta: AskUserQuestionPermissionMeta,
  outcome: { _meta?: Record<string, unknown> | null } | null | undefined
): AskUserQuestionAnswers | null {
  if (!outcome || !isRecord(outcome._meta)) return null;

  const rawAnswers =
    meta.source === 'codex'
      ? getCodexOutcomeAnswers(outcome._meta)
      : getClaudeOutcomeAnswers(outcome._meta);

  if (!rawAnswers) return null;

  const result: AskUserQuestionAnswers = {};
  for (const [index, question] of meta.questions.entries()) {
    const key = getAskUserQuestionAnswerKey(meta.questions, index);
    const raw = rawAnswers[key];
    if (raw === undefined) continue;

    if (meta.source === 'codex') {
      if (!isRecord(raw)) continue;
      const inner = raw.answers;
      if (!Array.isArray(inner)) continue;
      const values = inner.filter((value): value is string => typeof value === 'string');
      if (values.length === 0) continue;
      result[key] = question.multiSelect ? values : (values[0] ?? '');
    } else if (typeof raw === 'string') {
      result[key] = raw;
    } else if (Array.isArray(raw)) {
      const values = raw.filter((value): value is string => typeof value === 'string');
      if (values.length === 0) continue;
      result[key] = question.multiSelect ? values : (values[0] ?? '');
    }
  }
  return Object.keys(result).length > 0 ? result : null;
}

export function createAskUserQuestionPermissionOutcome(
  optionId: string,
  answers: AskUserQuestionAnswers,
  metaOrSource: AskUserQuestionPermissionMeta | AskUserQuestionSource = 'claude'
): PermissionOutcome {
  const source = typeof metaOrSource === 'string' ? metaOrSource : metaOrSource.source;
  if (source === 'codex') {
    const codexAnswers: Record<string, { answers: string[] }> = {};
    for (const [key, value] of Object.entries(answers)) {
      codexAnswers[key] = {
        answers: Array.isArray(value) ? value : [value],
      };
    }
    return {
      outcome: 'selected',
      optionId,
      _meta: {
        codex: {
          requestUserInput: {
            answers: codexAnswers,
          },
        },
      },
    };
  }

  return {
    outcome: 'selected',
    optionId,
    _meta: {
      claudeCode: {
        askUserQuestion: {
          answers,
        },
      },
    },
  };
}

// ============================================================================
// Elicitation bridge (acp-extension-claude >= 0.44.0)
//
// As of 0.44.0 Claude no longer surfaces AskUserQuestion as a permission
// request with `_meta.claudeCode.askUserQuestion`; it renders the questions as
// an ACP *form elicitation* (`elicitation/create`) instead, and the tool is
// disabled entirely unless the client advertises `elicitation.form`.
//
// Rather than build a parallel elicitation UI/persistence path, we bridge the
// form elicitation onto the existing AskUserQuestion permission flow: parse the
// requested JSON-schema form back into `AskUserQuestionPermissionMeta`, reuse
// the unchanged permission UI, then fold the user's answers back into a
// `CreateElicitationResponse`. Rejected: a native elicitation path would
// duplicate the question card, history persistence, and outcome wiring for no
// behavioral gain.
// ============================================================================

/**
 * Result of parsing an AskUserQuestion form elicitation. `fieldKeys[i]` is the
 * schema property key for `meta.questions[i]`, retained so the answers can be
 * folded back into the elicitation response by field key.
 */
export type AskUserQuestionElicitation = {
  meta: AskUserQuestionPermissionMeta;
  fieldKeys: string[];
  customFieldKeys?: Array<string | undefined>;
  autoResolutionMs?: number | null;
};

type EnumOptionLike = { const: string; title?: string; description?: string };

const isEnumOption = (value: unknown): value is EnumOptionLike =>
  isRecord(value) && typeof value.const === 'string';

/**
 * The list of `{ const, title }` enum options for a form property, drawn from a
 * single-select `oneOf`/`enum` or a multi-select `items.anyOf`/`items.enum`.
 * Returns `null` when the property carries no enum (i.e. it is a free-text
 * field, not a question).
 */
const getEnumOptionSource = (prop: Record<string, unknown>): unknown[] | null => {
  if (Array.isArray(prop.oneOf)) return prop.oneOf;
  if (Array.isArray(prop.enum)) return prop.enum;
  const items = prop.items;
  if (isRecord(items)) {
    if (Array.isArray(items.anyOf)) return items.anyOf;
    if (Array.isArray(items.enum)) return items.enum;
  }
  return null;
};

const isQuestionProperty = (prop: unknown): prop is Record<string, unknown> =>
  isRecord(prop) && getEnumOptionSource(prop) !== null;

const isFreeTextProperty = (prop: unknown): boolean =>
  isRecord(prop) &&
  prop.type === 'string' &&
  !Array.isArray(prop.oneOf) &&
  !Array.isArray(prop.enum);

const isMultiSelectProperty = (prop: Record<string, unknown>): boolean =>
  prop.type === 'array' || isRecord(prop.items);

const parseElicitationOptions = (source: unknown[]): AskUserQuestionOption[] => {
  const options: AskUserQuestionOption[] = [];
  for (const entry of source) {
    if (typeof entry === 'string') {
      options.push({ label: entry });
      continue;
    }
    if (!isEnumOption(entry)) continue;
    const label = entry.const;
    const title = typeof entry.title === 'string' ? entry.title : '';
    // The agent encodes an option's description as `${label} — ${description}`
    // in the enum title (and uses the bare label when there is no description).
    const separator = `${label} — `;
    const description =
      typeof entry.description === 'string' && entry.description.trim()
        ? entry.description
        : title && title !== label
          ? title.startsWith(separator)
            ? title.slice(separator.length)
            : title
          : undefined;
    options.push({ label, ...(description ? { description } : {}) });
  }
  return options;
};

/**
 * Parse an ACP form elicitation produced by Claude's AskUserQuestion tool back
 * into `AskUserQuestionPermissionMeta`. Returns `null` for elicitations that are
 * not AskUserQuestion-shaped (url mode, or a form with no enum-backed question
 * fields) so callers can fall back to declining them.
 */
export function parseAskUserQuestionElicitationRequest(
  request: CreateElicitationRequest
): AskUserQuestionElicitation | null {
  if (!isRecord(request) || request.mode !== 'form') return null;

  const schema = request.requestedSchema;
  if (!isRecord(schema) || !isRecord(schema.properties)) return null;

  const entries = Object.entries(schema.properties);
  const requestCodexMeta = getCodexMeta(request._meta);
  const isCodexForm =
    (requestCodexMeta !== null && 'autoResolutionMs' in requestCodexMeta) ||
    entries.some(([, prop]) => isRecord(prop) && getCodexMeta(prop._meta) !== null);
  const customFieldKeyByQuestionId = new Map<string, string>();
  if (isCodexForm) {
    for (const [key, prop] of entries) {
      if (!isRecord(prop)) continue;
      const codexMeta = getCodexMeta(prop._meta);
      if (
        codexMeta?.isOtherAnswer === true &&
        typeof codexMeta.questionId === 'string' &&
        codexMeta.questionId.length > 0
      ) {
        customFieldKeyByQuestionId.set(codexMeta.questionId, key);
      }
    }
  }
  const questionEntries = entries.filter(([, prop]) => {
    if (!isRecord(prop)) return false;
    if (!isCodexForm) return isQuestionProperty(prop);
    const codexMeta = getCodexMeta(prop._meta);
    return codexMeta?.isOtherAnswer !== true && prop.type === 'string';
  });
  if (questionEntries.length === 0) return null;

  const singleQuestion = questionEntries.length === 1;
  const allowCustomAnswer = isCodexForm
    ? questionEntries.some(([key, prop]) => {
        if (!isRecord(prop)) return false;
        const codexMeta = getCodexMeta(prop._meta);
        return (
          getEnumOptionSource(prop) === null ||
          codexMeta?.isOther === true ||
          customFieldKeyByQuestionId.has(key)
        );
      })
    : entries.some(([, prop]) => isFreeTextProperty(prop));
  const message = typeof request.message === 'string' ? request.message : '';

  const questions: AskUserQuestion[] = [];
  const fieldKeys: string[] = [];
  const customFieldKeys: Array<string | undefined> = [];
  for (const [key, prop] of questionEntries) {
    if (!isRecord(prop)) continue;
    const source = getEnumOptionSource(prop);
    if (!source && !isCodexForm) continue;
    const header = typeof prop.title === 'string' ? prop.title : '';
    const description = typeof prop.description === 'string' ? prop.description : '';
    // For a single-question form the prompt rides on the request `message`;
    // multi-question forms carry each prompt in the field `description`.
    const question = singleQuestion
      ? message || description || header
      : description || message || header;

    questions.push({
      ...(isCodexForm ? { id: key } : {}),
      question,
      header,
      options: source ? parseElicitationOptions(source) : [],
      multiSelect: !isCodexForm && isMultiSelectProperty(prop),
      ...(isCodexForm
        ? {
            allowCustomAnswer:
              source === null ||
              getCodexMeta(prop._meta)?.isOther === true ||
              customFieldKeyByQuestionId.has(key),
            isSecret: getCodexMeta(prop._meta)?.isSecret === true,
          }
        : {}),
    });
    fieldKeys.push(key);
    customFieldKeys.push(customFieldKeyByQuestionId.get(key));
  }

  if (questions.length === 0) return null;

  return {
    meta: {
      source: isCodexForm ? 'codex' : 'claude',
      version: 1,
      allowCustomAnswer,
      questions,
    },
    fieldKeys,
    ...(isCodexForm ? { customFieldKeys } : {}),
    ...(isCodexForm &&
    (typeof requestCodexMeta?.autoResolutionMs === 'number' ||
      requestCodexMeta?.autoResolutionMs === null)
      ? { autoResolutionMs: requestCodexMeta.autoResolutionMs as number | null }
      : {}),
  };
}

/**
 * Fold a permission outcome (from the bridged AskUserQuestion UI) back into a
 * `CreateElicitationResponse`. Cancellation maps to `cancel`; selected answers
 * are written into the form `content` keyed by their original schema field key.
 * A selection with no parsed answers becomes an empty `accept` (the user is
 * treated as having skipped, matching the built-in tool rather than aborting).
 */
export function buildAskUserQuestionElicitationResponse(
  elicitation: AskUserQuestionElicitation,
  response: RequestPermissionResponse | null | undefined
): CreateElicitationResponse {
  const outcome = response?.outcome as PermissionOutcome | undefined;
  if (!outcome || outcome.outcome !== 'selected' || outcome.optionId === 'cancel') {
    return { action: 'cancel' };
  }

  const answers = extractAskUserQuestionAnswersFromOutcome(elicitation.meta, {
    _meta: isRecord(outcome._meta) ? outcome._meta : null,
  });
  if (!answers) {
    return { action: 'accept', content: {} };
  }

  const content: Record<string, AskUserQuestionAnswerValue> = {};
  elicitation.meta.questions.forEach((_question, index) => {
    const fieldKey = elicitation.fieldKeys[index];
    if (!fieldKey) return;
    const value = answers[getAskUserQuestionAnswerKey(elicitation.meta.questions, index)];
    if (value === undefined) return;
    const customFieldKey = elicitation.customFieldKeys?.[index];
    const selectedQuestion = elicitation.meta.questions[index];
    const isCustomValue =
      typeof value === 'string' &&
      selectedQuestion !== undefined &&
      selectedQuestion.options.length > 0 &&
      !selectedQuestion.options.some((option) => option.label === value);
    content[isCustomValue && customFieldKey ? customFieldKey : fieldKey] = value;
  });

  return { action: 'accept', content };
}
