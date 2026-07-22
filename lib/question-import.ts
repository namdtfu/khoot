export type ImportedQuestion = {
  prompt: string;
  options: [string, string, string, string];
  correct_option: number;
  sourceLabel: string;
};

export type QuestionImportError = {
  sourceLabel: string;
  message: string;
};

export type QuestionImportResult = {
  questions: ImportedQuestion[];
  errors: QuestionImportError[];
};

type QuestionBlock = {
  sourceLabel: string;
  body: string;
};

type OptionMarker = {
  index: number;
  end: number;
  letter: string;
  starred: boolean;
};

const QUESTION_MARKER = /\b(?:câu|cau)\s*(\d+)\s*[:.)-]\s*/giu;
const ANSWER_DIRECTIVE = /(?:^|\s)(?:đáp\s*án(?:\s*đúng)?|dap\s*an(?:\s*dung)?|đ\.?\s*a\.?|d\.?\s*a\.?|answer)\s*[:=-]\s*([A-D1-4])\b/giu;
const OPTION_MARKER = /(?:^|\s)(\*)?\s*([A-D])\s*[.):]\s*/giu;

function compactWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function answerIndex(value: string) {
  const normalized = value.toUpperCase();
  if (/^[1-4]$/.test(normalized)) return Number(normalized) - 1;
  return normalized.charCodeAt(0) - 65;
}

function splitQuestionBlocks(source: string): QuestionBlock[] {
  const normalized = source.replace(/\r\n?/g, "\n").trim();
  if (!normalized) return [];

  const markers = Array.from(normalized.matchAll(QUESTION_MARKER));
  if (!markers.length) return [{ sourceLabel: "1", body: normalized }];

  return markers.map((marker, index) => {
    const start = (marker.index ?? 0) + marker[0].length;
    const end = markers[index + 1]?.index ?? normalized.length;
    return {
      sourceLabel: marker[1],
      body: normalized.slice(start, end).trim(),
    };
  });
}

function findOptionSequence(markers: OptionMarker[]) {
  for (let index = 0; index <= markers.length - 4; index += 1) {
    const letters = markers.slice(index, index + 4).map((marker) => marker.letter).join("");
    if (letters === "ABCD") return markers.slice(index, index + 4);
  }
  return null;
}

export function parseQuestionText(source: string): QuestionImportResult {
  const questions: ImportedQuestion[] = [];
  const errors: QuestionImportError[] = [];
  const blocks = splitQuestionBlocks(source);

  if (!blocks.length) return { questions, errors };

  for (const block of blocks) {
    const answerMatches = Array.from(block.body.matchAll(ANSWER_DIRECTIVE));
    const declaredAnswers = [...new Set(answerMatches.map((match) => answerIndex(match[1])))];
    const content = block.body.replace(ANSWER_DIRECTIVE, " ").trim();
    const optionMarkers = Array.from(content.matchAll(OPTION_MARKER)).map<OptionMarker>((match) => ({
      index: match.index ?? 0,
      end: (match.index ?? 0) + match[0].length,
      letter: match[2].toUpperCase(),
      starred: Boolean(match[1]),
    }));
    const sequence = findOptionSequence(optionMarkers);

    if (!sequence) {
      errors.push({
        sourceLabel: block.sourceLabel,
        message: "Không nhận diện đủ 4 lựa chọn A, B, C, D.",
      });
      continue;
    }

    const prompt = compactWhitespace(content.slice(0, sequence[0].index));
    const options = sequence.map((marker, index) => {
      const end = sequence[index + 1]?.index ?? content.length;
      return compactWhitespace(content.slice(marker.end, end));
    });

    if (!prompt) {
      errors.push({ sourceLabel: block.sourceLabel, message: "Nội dung câu hỏi đang để trống." });
      continue;
    }

    if (options.some((option) => !option)) {
      errors.push({ sourceLabel: block.sourceLabel, message: "Có lựa chọn chưa có nội dung." });
      continue;
    }

    if (declaredAnswers.length > 1) {
      errors.push({ sourceLabel: block.sourceLabel, message: "Có nhiều dòng đáp án không trùng nhau." });
      continue;
    }

    const starredAnswers = sequence
      .map((marker, index) => marker.starred ? index : -1)
      .filter((index) => index >= 0);

    if (starredAnswers.length > 1) {
      errors.push({ sourceLabel: block.sourceLabel, message: "Chỉ được đánh dấu một lựa chọn đúng bằng dấu *." });
      continue;
    }

    const declaredAnswer = declaredAnswers[0];
    const starredAnswer = starredAnswers[0];
    if (declaredAnswer === undefined && starredAnswer === undefined) {
      errors.push({
        sourceLabel: block.sourceLabel,
        message: "Chưa có đáp án đúng. Thêm “Đáp án: A” hoặc đặt dấu * trước lựa chọn đúng.",
      });
      continue;
    }

    if (declaredAnswer !== undefined && starredAnswer !== undefined && declaredAnswer !== starredAnswer) {
      errors.push({ sourceLabel: block.sourceLabel, message: "Dòng đáp án và lựa chọn có dấu * không trùng nhau." });
      continue;
    }

    questions.push({
      prompt,
      options: options as [string, string, string, string],
      correct_option: declaredAnswer ?? starredAnswer,
      sourceLabel: block.sourceLabel,
    });
  }

  return { questions, errors };
}
