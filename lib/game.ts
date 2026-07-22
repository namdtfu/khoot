export type GameStatus = "waiting" | "countdown" | "playing" | "reveal" | "finished";

export type GameRoom = {
  id: string;
  public_token: string;
  title: string;
  status: GameStatus;
  time_limit_seconds: number;
  current_question: number;
  question_count: number;
  max_players: number;
  lobby_token: string | null;
  lobby_name: string | null;
  question_started_at: string | null;
  reveal_started_at: string | null;
  started_at: string | null;
  finished_at: string | null;
};

export type GamePlayer = {
  id: string;
  name: string;
  is_ready: boolean;
  score: number;
  answered: boolean;
};

export type GameQuestion = {
  id: string;
  position: number;
  prompt: string;
  options: string[];
  correct_option?: number;
};

export type GameSelf = {
  id: string;
  name: string;
  is_ready: boolean;
  score: number;
  selected_option: number | null;
  points: number | null;
  is_correct: boolean | null;
};

export type GameStat = {
  player_id: string;
  name: string;
  score: number;
  answered_count: number;
  correct_count: number;
  average_response_ms: number;
};

export type GameHistoryAnswer = {
  player_id: string;
  selected_option: number;
  is_correct: boolean;
  response_ms: number;
  points: number;
};

export type GameHistoryQuestion = {
  id: string;
  position: number;
  prompt: string;
  options: string[];
  correct_option: number;
  answers: GameHistoryAnswer[];
};

export type GameSnapshot = {
  room: GameRoom;
  players: GamePlayer[];
  question: GameQuestion | null;
  self: GameSelf | null;
  stats: GameStat[];
  history?: GameHistoryQuestion[];
};

export type GameLobby = {
  id: string;
  public_token: string;
  name: string;
  active_game_id: string | null;
};

export type GameLobbyResolution = {
  lobby: {
    id: string | null;
    public_token: string;
    name: string;
  };
  active_game: {
    id: string | null;
    public_token: string;
    title: string;
    status: GameStatus;
    max_players: number;
    created_at: string;
  } | null;
  is_host: boolean;
};

export const ANSWER_SHAPES = ["▲", "◆", "●", "■"];

export function getRoomToken() {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get("room") ?? "";
}

export function getBasePath() {
  if (typeof window === "undefined") return "";
  return window.location.pathname.startsWith("/khoot") ? "/khoot" : "";
}

export function buildPlayerLink(publicToken: string) {
  if (typeof window === "undefined") return "";
  return `${window.location.origin}${getBasePath()}/play/?room=${publicToken}`;
}

export function buildLobbyLink(lobbyToken: string) {
  if (typeof window === "undefined") return "";
  return `${window.location.origin}${getBasePath()}/room/?room=${lobbyToken}`;
}

export function getErrorMessage(error: unknown) {
  if (error && typeof error === "object" && "message" in error) {
    return String(error.message);
  }
  return String(error);
}

export function secondsRemaining(startedAt: string | null, limitSeconds: number, now: number) {
  if (!startedAt) return limitSeconds;
  const elapsed = (now - new Date(startedAt).getTime()) / 1000;
  return Math.max(0, limitSeconds - elapsed);
}

export function countdownValue(startedAt: string | null, now: number) {
  if (!startedAt) return 3;
  return Math.max(1, Math.ceil((new Date(startedAt).getTime() - now) / 1000));
}

export function formatResponseTime(milliseconds: number) {
  if (!milliseconds) return "—";
  return `${(milliseconds / 1000).toFixed(2)} giây`;
}
