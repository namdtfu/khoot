import type { GameSnapshot } from "./game";

function csvCell(value: unknown) {
  const valueText = value == null ? "" : String(value);
  return '"' + valueText.replace(/"/g, '""') + '"';
}

export function safeFilename(value: string) {
  const normalized = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[đĐ]/g, (letter) => letter === "đ" ? "d" : "D")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return normalized || "khoot";
}

export function gameHistoryToCsv(snapshot: GameSnapshot) {
  const players = [...snapshot.players].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, "vi"));
  const history = snapshot.history ?? [];
  const rows: string[][] = [["Câu hỏi", "Đáp án đúng", ...players.map((player) => player.name)]];

  for (const question of history) {
    rows.push([
      String(question.position + 1) + ". " + question.prompt,
      question.options[question.correct_option] ?? "",
      ...players.map((player) => {
        const answer = question.answers.find((item) => item.player_id === player.id);
        if (!answer) return "Không trả lời";
        const selected = question.options[answer.selected_option] ?? "";
        return (answer.is_correct ? "Đúng: " : "Sai: ") + selected;
      }),
    ]);
  }

  rows.push([]);
  rows.push(["Tổng điểm", "", ...players.map((player) => String(player.score))]);
  return "\uFEFF" + rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
}

export function downloadTextFile(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
