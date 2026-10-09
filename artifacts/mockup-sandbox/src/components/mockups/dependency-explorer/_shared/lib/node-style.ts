import type { NodeKind } from "../graph/types";

export const KIND_COLOR: Record<NodeKind, string> = {
  service: "#1e6b73",
  package: "#b0641c",
  database: "#2c5b8c",
  queue: "#8b4a73",
  external: "#5d6770",
};
export const KIND_LABEL: Record<NodeKind, string> = {
  service: "Service",
  package: "Package",
  database: "Database",
  queue: "Queue",
  external: "External",
};
/** 24x24 stroke icons, shared by Canvas (Path2D) and React (svg). */
export const ICON_PATH: Record<NodeKind, string> = {
  service: "M4 4h16v6H4z M4 14h16v6H4z M8 7h.01 M8 17h.01",
  package: "M12 3 4 7.5v9L12 21l8-4.5v-9z M4 7.5 12 12l8-4.5 M12 12v9",
  database:
    "M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3z M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6 M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3",
  queue: "M4 6h10 M4 12h16 M4 18h10 M17 3l4 3-4 3",
  external: "M14 4h6v6 M20 4l-9 9 M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5",
};
export const ROLE_COLOR = {
  root: "#14212b",
  dependency: "#14876a",
  dependent: "#d98a0b",
  both: "#7a6a1e",
  cycle: "#c0203f",
} as const;

export const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(" ");
