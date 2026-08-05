import type { AreaCard, Coord, RoomSlot } from "../types";
import { useStore } from "../store";
import { OverlayHeader } from "./OverlayHeader";
import { Section, ToggleRow } from "./fields";
import { MenuLink } from "./SubMenuScreen";
import { GRID_LIMIT, roomKey } from "../lib/gazetteer";

/**
 * The map (DESIGN.md → Foresight → The map).
 *
 * Two grids, unrelated to one another: a world grid for regions and a local
 * grid inside each one. No zoom continuity between them, as in every CRPG that
 * has ever shipped two maps.
 *
 * The rule that makes it safe is already in the codebase: **coordinates are
 * internal**, like `GameState.minutes`. No model — narrator or prep — ever sees
 * or writes a number; prep emits rooms and exits by NAME and the client places
 * every one of them itself. So this screen is a pure read of geometry nothing
 * outside the app authored.
 *
 * Rendering is where a 1-bit app has an unfair advantage: inline SVG, no image
 * model, no `images.ts` involvement at all. Filled = visited · outline = named
 * but never walked into · current room inverted · exits as rules between cells.
 *
 * It is a PLAY screen, in the ⋯ quick menu beside Party and Inventory — the map
 * is the player's. The threats stay private on the Foresight screen.
 */

/** Cell pitch in SVG units. Rooms are drawn as squares with a gap between them. */
const CELL = 24;
const BOX = 16;

/** What one grid of rooms (or regions) draws as. */
interface Node {
  key: string;
  name: string;
  coord: Coord;
  visited: boolean;
  current: boolean;
  exits: string[];
}

export function MapScreen() {
  const game = useStore((s) => s.game);
  const fog = useStore((s) => s.settings.mapFog);
  const foresight = useStore((s) => s.settings.foresightEnabled);
  const update = useStore((s) => s.updateSettings);

  const areas = Object.values(game.areas ?? {});
  const area = game.areaKey ? (game.areas ?? {})[game.areaKey] : undefined;
  const here = roomKey(game.location);

  const rooms: Node[] = Object.entries(area?.rooms ?? {})
    .map(([key, room]: [string, RoomSlot]) => ({
      key,
      name: room.name,
      coord: room.coord,
      visited: room.visited,
      current: key === here,
      exits: room.exits,
    }))
    // Fog hides the rumours — the rooms a region NAMED that nobody has walked
    // into. They are hooks, so they are shown by default; hiding them is for a
    // player who would rather discover the shape themselves.
    .filter((n) => fog || n.visited || n.current);

  const world: Node[] = areas.map((a: AreaCard) => ({
    key: a.key,
    name: a.name,
    coord: a.coord,
    visited: true,
    current: a.key === game.areaKey,
    exits: a.neighbours,
  }));

  return (
    <main className="flex h-full min-h-full flex-col bg-paper text-ink font-mono">
      <OverlayHeader title="Map" />

      <div className="flex-1 space-y-4 overflow-y-auto p-3">
        {!foresight && (
          <p className="border-2 border-ink p-3 text-xs uppercase tracking-widest opacity-70">
            Foresight is off —{" "}
            <MenuLink screen="narrator" section="foresight">
              Narrator → Foresight
            </MenuLink>
            . The map stops filling in, but keeps everything already walked.
          </p>
        )}

        {!area && (
          <p className="uppercase tracking-widest opacity-60">
            Nothing mapped yet — the map draws itself as you travel.
          </p>
        )}

        {area && (
          <>
            <Section label={area.name} />
            <Grid nodes={rooms} label={`Rooms in ${area.name}`} />
            <p className="text-xs uppercase tracking-widest opacity-60">
              filled · walked&nbsp;&nbsp;outline · heard of&nbsp;&nbsp;inverted · you are
              here
            </p>
          </>
        )}

        {world.length > 1 && (
          <>
            <Section label="The World" />
            <Grid nodes={world} label="Regions" />
          </>
        )}

        <ToggleRow
          label="Show Places You Have Only Heard Of"
          state={fog ? "ON" : "OFF"}
          onClick={() => update({ mapFog: !fog })}
        />
        <p className="text-xs opacity-70">
          A region names the places inside it before you reach them. This decides whether
          the map shows those, or only where you have actually been. It changes nothing
          the narrator sees.
        </p>
      </div>
    </main>
  );
}

/**
 * One grid, as inline SVG.
 *
 * Exits are drawn as rules between cells WHEREVER THEY SIT — adjacency is never
 * promised, because a graph no grid embedding could honour still has to render.
 * That is the same reason placement is a spiral rather than a solver: a map that
 * is readable and occasionally crossed beats one that cannot be drawn.
 */
function Grid({ nodes, label }: { nodes: Node[]; label: string }) {
  if (!nodes.length) {
    return <p className="text-xs uppercase tracking-widest opacity-60">Nothing here yet.</p>;
  }

  const xs = nodes.map((n) => n.coord.x);
  const ys = nodes.map((n) => n.coord.y);
  const minX = Math.max(-GRID_LIMIT, Math.min(...xs));
  const minY = Math.max(-GRID_LIMIT, Math.min(...ys));
  const width = (Math.max(...xs) - minX + 1) * CELL;
  const height = (Math.max(...ys) - minY + 1) * CELL;

  const at = (c: Coord) => ({
    x: (c.x - minX) * CELL + CELL / 2,
    y: (c.y - minY) * CELL + CELL / 2,
  });

  const byKey = new Map(nodes.map((n) => [n.key, n]));
  // Each edge once: a symmetric exit list would otherwise draw every rule twice.
  const edges: { from: Node; to: Node }[] = [];
  for (const node of nodes) {
    for (const exit of node.exits) {
      const other = byKey.get(exit);
      if (!other || other.key <= node.key) continue;
      edges.push({ from: node, to: other });
    }
  }

  return (
    <div className="overflow-x-auto border-2 border-ink p-2">
      <svg
        role="img"
        aria-label={label}
        viewBox={`0 0 ${width} ${height}`}
        className="h-auto w-full"
        style={{ maxWidth: `${width * 2}px` }}
      >
        {edges.map(({ from, to }) => {
          const a = at(from.coord);
          const b = at(to.coord);
          return (
            <line
              key={`${from.key}-${to.key}`}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke="currentColor"
              strokeWidth={1}
            />
          );
        })}
        {nodes.map((node) => {
          const p = at(node.coord);
          return (
            <g key={node.key}>
              <rect
                x={p.x - BOX / 2}
                y={p.y - BOX / 2}
                width={BOX}
                height={BOX}
                fill={node.current || node.visited ? "currentColor" : "none"}
                stroke="currentColor"
                strokeWidth={node.current ? 3 : 1.5}
              />
              {node.current && (
                <circle cx={p.x} cy={p.y} r={BOX / 6} className="fill-paper" />
              )}
              <title>{node.name}</title>
            </g>
          );
        })}
      </svg>
      <ul className="mt-2 space-y-1 text-xs">
        {nodes.map((n) => (
          <li key={n.key} className={n.visited || n.current ? "" : "opacity-60"}>
            {n.current ? "▶ " : "· "}
            {n.name}
          </li>
        ))}
      </ul>
    </div>
  );
}
