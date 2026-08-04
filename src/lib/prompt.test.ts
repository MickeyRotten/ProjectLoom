import { describe, it, expect } from "vitest";
import {
  buildMessages,
  buildHistory,
  approxTokens,
  formatPartyRoster,
  formatPartyComposition,
  formatRegenerateNote,
} from "./prompt";
import { defaultPC, newGame, defaultSettings } from "./defaults";
import { PARTY_LIMIT } from "./roster";
import { DEFAULT_DICE } from "./stakes";
import { builtinTemplates } from "./imageTemplates";
import type { Character, GameState, Message, RosterEntry, Settings } from "../types";

/** Settings whose SELECTED image template carries this appearance rule. */
function appearanceRule(text: string): Partial<Settings> {
  const [prose, ...rest] = builtinTemplates();
  return {
    imageTemplates: [{ ...prose, appearanceInstructions: text }, ...rest],
    imageTemplateId: prose.id,
  };
}

const settings = defaultSettings();

/**
 * The prompt now reads from BOTH halves of the cast model, so every call needs
 * a character library alongside the game. Defaults to just the PC.
 */
function build(opts: {
  settings?: Settings;
  game: GameState;
  characters?: Character[];
  playerMessage: string;
}) {
  return buildMessages({
    settings: opts.settings ?? settings,
    game: opts.game,
    characters: opts.characters ?? [defaultPC()],
    playerMessage: opts.playerMessage,
  });
}

/** A game whose party is exactly the given character ids. */
function withParty(game: GameState, ...ids: string[]): GameState {
  const roster: RosterEntry[] = ids.map((id) => ({
    id,
    standing: "active",
    lastSpokeTurn: 0,
  }));
  return { ...game, roster };
}

function narr(turn: number, content: string): Message {
  return { id: `n${turn}`, role: "narrator", content, turn };
}
function play(turn: number, content: string): Message {
  return { id: `p${turn}`, role: "player", content, turn };
}

function member(patch: Partial<Character> & { id: string; name: string }): Character {
  return {
    role: "member", species: "human", sex: "", description: "", personality: "", drive: "",
    strengths: "", flaws: "", notes: "", equipment: [],
    ...patch,
  };
}

describe("buildMessages — ordering", () => {
  it("starts with a system context and ends with the player's new message", () => {
    const msgs = build({ settings, game: newGame(), playerMessage: "I head north." });
    expect(msgs[0].role).toBe("system");
    expect(msgs[0].content).toContain("SCENARIO");
    expect(msgs[msgs.length - 1]).toEqual({ role: "user", content: "I head north." });
  });

  it("puts the output-protocol system message after history, before the new message", () => {
    const msgs = build({ settings, game: newGame(), playerMessage: "go" });
    const protocolIdx = msgs.findIndex((m) => m.content.includes("<<<LOOM>>>"));
    const userIdx = msgs.length - 1;
    expect(protocolIdx).toBeGreaterThan(0);
    expect(protocolIdx).toBe(userIdx - 1);
    expect(msgs[protocolIdx].role).toBe("system");
  });

  it("folds the selected template's appearance rule into the protocol's party line", () => {
    const custom = { ...settings, ...appearanceRule('Write "description" as three vivid clauses.') };
    const msgs = build({ settings: custom, game: newGame(), playerMessage: "go" });
    const protocol = msgs.find((m) => m.content.includes("<<<LOOM>>>"))!;
    expect(protocol.content).toContain('Write "description" as three vivid clauses.');
    // A blank rule falls back to a built-in minimal one, never an empty gap.
    const blank = { ...settings, ...appearanceRule("  ") };
    const msgs2 = build({ settings: blank, game: newGame(), playerMessage: "go" });
    const protocol2 = msgs2.find((m) => m.content.includes("<<<LOOM>>>"))!;
    expect(protocol2.content).toContain('"description" is physical appearance only');
  });

  it("demands personality, drive, strengths, flaws and equipment on every party add", () => {
    const msgs = build({ settings, game: newGame(), playerMessage: "go" });
    const protocol = msgs.find((m) => m.content.includes("<<<LOOM>>>"))!;
    expect(protocol.content).toContain('"personality"');
    expect(protocol.content).toContain('"drive"');
    expect(protocol.content).toContain('"strengths"');
    expect(protocol.content).toContain('"flaws"');
    expect(protocol.content).toContain('"equipment"');
    expect(protocol.content).toContain('"sex"');
    expect(protocol.content).toContain('On every party "add", ALWAYS write');
  });

  it("puts the PC sheet in the standing context and the pack in the state block", () => {
    const g = newGame();
    g.inventory = [{ label: "Compass", description: "spins", quantity: 2 }];
    const msgs = build({ settings, game: g, playerMessage: "go" });
    expect(msgs[0].content).toContain("PLAYER CHARACTER");
    // The pack rides AFTER the history, with the rest of the state: the
    // protocol's "use the label already in INVENTORY" rule points at it, and up
    // in the standing context the two were a whole history window apart.
    const state = msgs.find((m) => m.content.includes("STATE OF PLAY"))!;
    expect(state.content).toContain("Compass ×2");
    expect(msgs[0].content).not.toContain("Compass");
  });

  it("states the pack, the board and the scene after the history, never before", () => {
    const g = newGame();
    g.inventory = [{ label: "Compass", description: "spins", quantity: 2 }];
    g.quests = [
      { id: "q1", label: "Find the well", description: "", reward: "", status: "active" },
    ];
    g.messages = [play(1, "go"), narr(1, "You go.")];
    const msgs = build({ settings, game: g, playerMessage: "walk on" });
    const historyAt = msgs.findIndex((m) => m.content === "You go.");
    const stateAt = msgs.findIndex((m) => m.content.includes("STATE OF PLAY"));
    expect(historyAt).toBeGreaterThan(0);
    expect(stateAt).toBeGreaterThan(historyAt);
    const state = msgs[stateAt].content;
    expect(state).toContain("CURRENT SCENE");
    expect(state).toContain("ACTIVE PARTY — THIS TURN");
    expect(state).toContain("INVENTORY — what the player is carrying");
    expect(state).toContain("ACTIVE QUESTS — open and unfinished");
  });

  it("omits an empty pack and an empty board rather than printing headers", () => {
    // A new game ships with Gold and no quests, so empty the pack explicitly.
    const g: GameState = { ...newGame(), inventory: [], quests: [] };
    const state = build({ settings, game: g, playerMessage: "go" }).find((m) =>
      m.content.includes("STATE OF PLAY"),
    )!;
    expect(state.content).not.toContain("INVENTORY");
    expect(state.content).not.toContain("ACTIVE QUESTS");
    // The roll call is the exception, and stays emitted: "you travel alone" is
    // exactly the case the history drifts on.
    expect(state.content).toContain("ACTIVE PARTY — THIS TURN");
  });

  it("names the PC's species and sex on the identity line", () => {
    const msgs = build({ settings, game: newGame(), playerMessage: "go" });
    expect(msgs[0].content).toContain("PLAYER CHARACTER — Hiro (Human, Male)");
  });

  it("drops a blank sex from the identity line", () => {
    const pc = { ...defaultPC(), sex: "" };
    const msgs = build({ settings, game: newGame(), characters: [pc], playerMessage: "go" });
    expect(msgs[0].content).toContain("PLAYER CHARACTER — Hiro (Human)");
  });

  it("carries the player's own Notes on the PC sheet", () => {
    const pc = { ...defaultPC(), notes: "he lies about his age" };
    const msgs = build({ settings, game: newGame(), characters: [pc], playerMessage: "go" });
    expect(msgs[0].content).toContain("Notes: he lies about his age");
  });

  it("prints no Notes label when the player wrote none", () => {
    const msgs = build({ settings, game: newGame(), playerMessage: "go" });
    expect(msgs[0].content).not.toContain("Notes:");
  });

  it("includes PC personality + drive in the system context", () => {
    const pc = {
      ...defaultPC(),
      personality: "Stoic, dry-witted.",
      drive: "Find the last archive.",
    };
    const msgs = build({ settings, game: newGame(), characters: [pc], playerMessage: "go" });
    expect(msgs[0].content).toContain("Personality: Stoic, dry-witted.");
    expect(msgs[0].content).toContain("Drive: Find the last archive.");
  });
});

describe("party roster + spotlight", () => {
  const navi = member({
    id: "m-navi", name: "Navi", species: "sprite", sex: "female",
    description: "a darting spark",
    strengths: "Lockpicking — opens any lock",
    flaws: "Panics in the dark.",
  });

  const cast = [defaultPC(), navi];

  it("includes the party roster in the system context", () => {
    const g = withParty(newGame(), "m-navi");
    const msgs = build({ settings, game: g, characters: cast, playerMessage: "go" });
    expect(msgs[0].content).toContain("PARTY — in your company");
    expect(msgs[0].content).toContain("Navi (sprite, female)");
    expect(msgs[0].content).toContain("Strengths: Lockpicking — opens any lock");
    expect(msgs[0].content).toContain("Flaws: Panics in the dark.");
  });

  it("injects a spotlight block after the system context, before history", () => {
    const g = withParty(newGame(), "m-navi");
    const msgs = build({ settings, game: g, characters: cast, playerMessage: "navi, open it" });
    const spotIdx = msgs.findIndex((m) => m.content.includes("PARTY SPOTLIGHT — THIS TURN"));
    expect(spotIdx).toBe(1);
    expect(msgs[spotIdx].content).toContain("Navi: addressed=yes");
  });

  it("shows the party what the STORY changed, not the authored sheet", () => {
    const g: GameState = {
      ...newGame(),
      roster: [
        {
          id: "m-navi",
          standing: "active",
          lastSpokeTurn: 0,
          overrides: { description: "singed and limping" },
        },
      ],
    };
    const msgs = build({ settings, game: g, characters: cast, playerMessage: "go" });
    expect(msgs[0].content).toContain("singed and limping");
    expect(msgs[0].content).not.toContain("a darting spark");
  });

  it("omits roster + spotlight when the party is empty", () => {
    // The cast exists in the library, but nobody is travelling with the player.
    const msgs = build({ settings, game: newGame(), characters: cast, playerMessage: "go" });
    expect(msgs.some((m) => m.content.includes("PARTY SPOTLIGHT"))).toBe(false);
    expect(msgs[0].content).not.toContain("PARTY — in your company");
  });

  it("carries a member's player Notes, and omits a blank one", () => {
    const navi = member({ id: "m-navi", name: "Navi", notes: "never lets her speak first" });
    const bram = member({ id: "m-bram", name: "Bram" });
    const block = formatPartyRoster([
      { ...navi, lastSpokeTurn: 0, standing: "active", condition: "" },
      { ...bram, lastSpokeTurn: 0, standing: "active", condition: "" },
    ]);
    expect(block).toContain("  Notes: never lets her speak first");
    expect(block.match(/Notes:/g)).toHaveLength(1);
  });

  it("characters outside the party are excluded from the roster", () => {
    expect(formatPartyRoster([])).toBe("");
  });
});

describe("active party roll call", () => {
  const navi = member({ id: "m-navi", name: "Navi", species: "sprite" });
  const bram = member({ id: "m-bram", name: "Bram", species: "human" });
  const cast = [defaultPC(), navi, bram];

  function rollCall(msgs: { content: string }[]) {
    return msgs.find((m) => m.content.includes("ACTIVE PARTY — THIS TURN"));
  }

  it("names the current party after the history, right before the protocol", () => {
    const g = withParty(newGame(), "m-navi", "m-bram");
    g.messages = [narr(1, "The road forks.")];
    const msgs = build({ settings, game: g, characters: cast, playerMessage: "go" });
    const idx = msgs.findIndex((m) => m.content.includes("ACTIVE PARTY — THIS TURN"));
    const protocolIdx = msgs.findIndex((m) => m.content.includes("OUTPUT PROTOCOL"));
    expect(idx).toBe(protocolIdx - 1);
    expect(msgs[idx].role).toBe("system");
    expect(msgs[idx].content).toContain("Travelling with the player (2/3): Navi, Bram");
  });

  it("is emitted even with an empty party, saying the player is alone", () => {
    const msgs = build({ settings, game: newGame(), characters: cast, playerMessage: "go" });
    const block = rollCall(msgs);
    expect(block?.content).toContain("nobody — the player is ALONE this turn.");
    expect(block?.content).toContain("Do not voice or act for a companion");
  });

  it("re-reads membership every turn — a kicked member drops out of the roll call", () => {
    const g = withParty(newGame(), "m-navi", "m-bram");
    const after: GameState = {
      ...g,
      roster: g.roster.map((e) =>
        e.id === "m-bram" ? { ...e, standing: "none" as const } : e,
      ),
    };
    const block = rollCall(build({ settings, game: after, characters: cast, playerMessage: "go" }));
    expect(block?.content).toContain("Navi");
    expect(block?.content).not.toContain("Bram");
  });

  it("lists who left and why, and forbids resurrecting the fallen", () => {
    const g: GameState = {
      ...newGame(),
      roster: [
        { id: "m-navi", standing: "active", lastSpokeTurn: 0 },
        { id: "m-bram", standing: "fallen", lastSpokeTurn: 2 },
      ],
    };
    const block = rollCall(build({ settings, game: g, characters: cast, playerMessage: "go" }));
    expect(block?.content).toContain("No longer travelling with the player: Bram (fallen)");
    expect(block?.content).toContain("never write them back into the scene as present");
  });

  it("keeps a departed member out of the travelling line but names the departure", () => {
    const g: GameState = {
      ...newGame(),
      roster: [{ id: "m-navi", standing: "departed", lastSpokeTurn: 1 }],
    };
    const block = rollCall(build({ settings, game: g, characters: cast, playerMessage: "go" }));
    expect(block?.content).toContain("nobody — the player is ALONE this turn.");
    expect(block?.content).toContain("Navi (departed)");
    // Only the fallen get the resurrection ban.
    expect(block?.content).not.toContain("never write them back");
  });

  it("caps the departure list to the most recent few", () => {
    const gone = Array.from({ length: 9 }, (_, i) =>
      member({ id: `m-${i}`, name: `Gone${i}` }),
    );
    const g: GameState = {
      ...newGame(),
      roster: gone.map((c) => ({
        id: c.id,
        standing: "departed" as const,
        lastSpokeTurn: 0,
      })),
    };
    const block = rollCall(
      build({ settings, game: g, characters: [defaultPC(), ...gone], playerMessage: "go" }),
    );
    expect(block?.content).not.toContain("Gone0");
    expect(block?.content).toContain("Gone8");
  });

  it("formats a bare composition without a departure line", () => {
    const solo = formatPartyComposition([]);
    expect(solo).not.toContain("No longer travelling");
  });

  it("names benched members apart from the travelling line", () => {
    const g: GameState = {
      ...newGame(),
      roster: [
        { id: "m-navi", standing: "active", lastSpokeTurn: 0 },
        { id: "m-bram", standing: "benched", lastSpokeTurn: 0 },
      ],
    };
    const block = rollCall(build({ settings, game: g, characters: cast, playerMessage: "go" }));
    expect(block?.content).toContain("Travelling with the player (1/3): Navi");
    expect(block?.content).toContain("With the party but NOT in this scene: Bram");
    // Benched is not gone — it must never read as a departure.
    expect(block?.content).not.toContain("No longer travelling");
  });

  it("names the world's NPCs every turn, without calling them companions", () => {
    const g: GameState = {
      ...newGame(),
      roster: [{ id: "m-bram", standing: "npc", lastSpokeTurn: 0 }],
    };
    const block = rollCall(build({ settings, game: g, characters: cast, playerMessage: "go" }));
    expect(block?.content).toContain("Known in this world, NOT companions: Bram");
    expect(block?.content).toContain("nobody — the player is ALONE this turn.");
  });
});

describe("benched members are not in the scene", () => {
  const navi = member({
    id: "m-navi",
    name: "Navi",
    species: "sprite",
    strengths: "Lockpicking — opens any lock",
    equipment: [{ label: "Bent Pick", description: "worn thin" }],
  });
  const cast = [defaultPC(), navi];
  const benched: GameState = {
    ...newGame(),
    roster: [{ id: "m-navi", standing: "benched", lastSpokeTurn: 0 }],
  };

  it("keeps them out of the roster block, the spotlight and their gear", () => {
    const msgs = build({
      settings,
      game: benched,
      characters: cast,
      playerMessage: "navi, pick the lock",
    });
    expect(msgs[0].content).not.toContain("PARTY — in your company");
    expect(msgs.some((m) => m.content.includes("PARTY SPOTLIGHT"))).toBe(false);
    expect(msgs.some((m) => m.content.includes("RELEVANT GEAR"))).toBe(false);
  });
});

describe("known characters block", () => {
  const mira = member({
    id: "m-mira",
    name: "Mira Aldgate",
    species: "human",
    description: "soot-streaked and broad-shouldered",
    personality: "Blunt.",
  });
  const bram = member({ id: "m-bram", name: "Bram", species: "human" });
  const cast = [defaultPC(), mira, bram];
  const withNpcs: GameState = {
    ...newGame(),
    roster: [
      { id: "m-mira", standing: "npc", lastSpokeTurn: 0 },
      { id: "m-bram", standing: "npc", lastSpokeTurn: 0 },
    ],
  };

  function known(msgs: { content: string }[]) {
    return msgs.find((m) => m.content.includes("KNOWN CHARACTERS"));
  }

  it("injects the sheet of an NPC the scene names", () => {
    const msgs = build({
      settings,
      game: withNpcs,
      characters: cast,
      playerMessage: "ask Mira about the blade",
    });
    const block = known(msgs);
    expect(block?.content).toContain("Mira Aldgate (human)");
    expect(block?.content).toContain("soot-streaked and broad-shouldered");
    expect(block?.content).toContain("Personality: Blunt.");
    expect(block?.content).toContain("NOT in the party");
    // Only the one who was named.
    expect(block?.content).not.toContain("Bram");
  });

  it("stays silent when the scene names nobody", () => {
    const msgs = build({
      settings,
      game: withNpcs,
      characters: cast,
      playerMessage: "walk on",
    });
    expect(known(msgs)).toBeUndefined();
  });

  it("matches on a recent beat, not just the new message", () => {
    const g = { ...withNpcs, messages: [narr(1, "Bram waves from the gate.")] };
    const msgs = build({ settings, game: g, characters: cast, playerMessage: "keep going" });
    expect(known(msgs)?.content).toContain("Bram");
  });

  it("never treats a party member as an NPC", () => {
    const g: GameState = {
      ...newGame(),
      roster: [{ id: "m-mira", standing: "active", lastSpokeTurn: 0 }],
    };
    const msgs = build({ settings, game: g, characters: cast, playerMessage: "ask Mira" });
    expect(known(msgs)).toBeUndefined();
    expect(msgs[0].content).toContain("PARTY — in your company");
  });
});

describe("world notes injection", () => {
  it("injects matched notes as a system block before the spotlight/history", () => {
    const g = newGame();
    g.worldNotes = [
      { id: "n1", title: "The Old Well", keywords: ["well"], content: "the last working well" },
    ];
    const msgs = build({ settings, game: g, playerMessage: "I search for the well" });
    const idx = msgs.findIndex((m) => m.content.includes("WORLD NOTES"));
    expect(idx).toBe(1); // right after the system context
    expect(msgs[idx].content).toContain("The Old Well: the last working well");
  });

  it("omits the block when no note matches the scan text", () => {
    const g = newGame();
    g.worldNotes = [{ id: "n1", title: "The Old Well", keywords: ["well"], content: "x" }];
    const msgs = build({ settings, game: g, playerMessage: "I climb the ridge" });
    expect(msgs.some((m) => m.content.includes("WORLD NOTES"))).toBe(false);
  });

  it("injects a permanent note even when nothing in the scan text matches", () => {
    const g = newGame();
    g.worldNotes = [
      { id: "n1", title: "The Ash Law", keywords: [], content: "no fires", permanent: true },
    ];
    const msgs = build({ settings, game: g, playerMessage: "I climb the ridge" });
    const block = msgs.find((m) => m.content.includes("WORLD NOTES"));
    expect(block?.content).toContain("The Ash Law: no fires");
  });

  it("matches keywords against recent beats, not just the new message", () => {
    const g = newGame();
    g.worldNotes = [{ id: "n1", title: "Ash Cult", keywords: ["ashers"], content: "zealots" }];
    g.messages = [narr(1, "The ashers block the gate.")];
    const msgs = build({ settings, game: g, playerMessage: "I step forward" });
    expect(msgs.some((m) => m.content.includes("WORLD NOTES"))).toBe(true);
  });
});

describe("the keyword scan window is one window", () => {
  // Every gate reads the new message + the last CONTEXT_TURNS beats. The notes
  // used to scan 3 turns while the NPC/spotlight/gear gates scanned 4 — three
  // matchers sharing `keywordHits` so that "mentioned" means one thing, and
  // then disagreeing about how much text to look at.
  const beats = (keyword: string) => {
    // Eight messages: the keyword sits in the oldest, exactly 4 turns back.
    const rest = Array.from({ length: 7 }, (_, i) => narr(i + 2, "The road goes on."));
    return [narr(1, keyword), ...rest];
  };

  const mira = member({ id: "m-mira", name: "Mira Aldgate", description: "soot-streaked" });

  it("matches a world note on a beat four turns back", () => {
    const g = newGame();
    g.worldNotes = [{ id: "n1", title: "Ash Cult", keywords: ["ashers"], content: "zealots" }];
    g.messages = beats("The ashers block the gate.");
    const msgs = build({ settings, game: g, playerMessage: "I step forward" });
    expect(msgs.some((m) => m.content.includes("WORLD NOTES"))).toBe(true);
  });

  it("matches an NPC sheet over that same window, not a wider one", () => {
    const g: GameState = {
      ...newGame(),
      roster: [{ id: "m-mira", standing: "npc", lastSpokeTurn: 0 }],
      messages: beats("Mira Aldgate waves from the forge."),
    };
    const msgs = build({
      settings,
      game: g,
      characters: [defaultPC(), mira],
      playerMessage: "I step forward",
    });
    expect(msgs.some((m) => m.content.includes("KNOWN CHARACTERS"))).toBe(true);

    // One beat older — outside the window for BOTH gates, not just one of them.
    const older: GameState = {
      ...g,
      messages: [narr(0, "Mira Aldgate waves from the forge."), ...beats("nothing here")],
    };
    const out = build({
      settings,
      game: older,
      characters: [defaultPC(), mira],
      playerMessage: "I step forward",
    });
    expect(out.some((m) => m.content.includes("KNOWN CHARACTERS"))).toBe(false);
  });
});

describe("turn context travels as one message", () => {
  const navi = member({
    id: "m-navi",
    name: "Navi",
    equipment: [{ label: "Bent Pick", description: "worn thin" }],
  });

  it("folds notes, NPC sheets, the spotlight and gear into a single system block", () => {
    const g = withParty(newGame(), "m-navi");
    g.worldNotes = [
      { id: "n1", title: "The Old Well", keywords: ["well"], content: "the last working well" },
    ];
    const msgs = build({
      settings,
      game: g,
      characters: [defaultPC(), navi],
      playerMessage: "Navi, pick the lock on the well",
    });
    // Match the block HEADERS, not the words — the roster's own header names
    // the spotlight ("use the PARTY SPOTLIGHT rules below") one message up.
    const turnContext = msgs.filter(
      (m) =>
        m.content.includes("WORLD NOTES — ") ||
        m.content.includes("PARTY SPOTLIGHT — THIS TURN") ||
        m.content.includes("RELEVANT GEAR — THIS TURN"),
    );
    expect(turnContext).toHaveLength(1);
    expect(turnContext[0].role).toBe("system");
    // …and it sits between the standing context and the history.
    expect(msgs.indexOf(turnContext[0])).toBe(1);
  });

  it("is skipped entirely on a turn that matched nothing", () => {
    const msgs = build({ settings, game: newGame(), playerMessage: "I wave hello" });
    // Standing context, then straight into the history.
    expect(msgs[1].role).toBe("assistant");
    expect(msgs[1].content).toBe(newGame().scenario.openingNarration);
  });
});

describe("output protocol — action options toggle", () => {
  it("asks for options by default", () => {
    const msgs = build({ settings, game: newGame(), playerMessage: "go" });
    const proto = msgs.find((m) => m.content.includes("OUTPUT PROTOCOL"))!;
    expect(proto.content).toContain('"options": array of 3–4 action strings');
  });

  it("tells the model to omit options when disabled", () => {
    const off = { ...settings, showActionOptions: false };
    const msgs = build({ settings: off, game: newGame(), playerMessage: "go" });
    const proto = msgs.find((m) => m.content.includes("OUTPUT PROTOCOL"))!;
    expect(proto.content).toContain("OMIT this field entirely");
    expect(proto.content).not.toContain('"options": array of 3–4 action strings');
  });
});

describe("relevant gear injection", () => {
  it("injects a gear block when an equipped item's keywords surface in the message", () => {
    const g = newGame();
    const msgs = build({
      settings,
      game: g,
      playerMessage: "I dig through my leather satchel",
    });
    const idx = msgs.findIndex((m) => m.content.includes("RELEVANT GEAR — THIS TURN"));
    expect(idx).toBeGreaterThan(0);
    expect(msgs[idx].role).toBe("system");
    expect(msgs[idx].content).toContain(
      "Hiro — Leather Satchel: Worn leather satchel for carrying supplies.",
    );
  });

  it("omits the block when no equipped item is relevant", () => {
    const msgs = build({ settings, game: newGame(), playerMessage: "I wave hello" });
    expect(msgs.some((m) => m.content.includes("RELEVANT GEAR"))).toBe(false);
  });

  const packRat = member({
    id: "m-pack",
    name: "Pack Rat",
    equipment: [{ label: "Lantern", description: "Casts a warm ring of light in the dark." }],
  });

  it("covers in-party members' gear, matched from recent beats too", () => {
    const g = withParty(newGame(), "m-pack");
    g.messages = [narr(1, "The tunnel ahead is pitch dark.")];
    const msgs = build({
      settings,
      game: g,
      characters: [defaultPC(), packRat],
      playerMessage: "I press on",
    });
    const block = msgs.find((m) => m.content.includes("RELEVANT GEAR — THIS TURN"));
    expect(block?.content).toContain("Pack Rat — Lantern");
  });

  it("gear of characters outside the party never rides along", () => {
    // Strip PC gear so only the out-of-party character's lantern could match.
    const msgs = build({
      settings,
      game: newGame(),
      characters: [{ ...defaultPC(), equipment: [] }, packRat],
      playerMessage: "I raise the lantern",
    });
    expect(msgs.some((m) => m.content.includes("RELEVANT GEAR"))).toBe(false);
  });
});

describe("output protocol — party standing", () => {
  const proto = () =>
    build({ settings, game: newGame(), playerMessage: "go" }).find((m) =>
      m.content.includes("OUTPUT PROTOCOL"),
    )!;

  it("teaches the model that remove can carry a departed/fallen standing", () => {
    expect(proto().content).toContain('"standing": "departed"');
    expect(proto().content).toContain('"standing": "fallen"');
    expect(proto().content).toContain("Removing never deletes anyone");
  });

  it("teaches the bench and the NPC tier, and states the party cap", () => {
    const content = proto().content;
    expect(content).toContain('"standing"');
    expect(content).toContain('"active"');
    expect(content).toContain('"benched"');
    expect(content).toContain('"npc"');
    // The cap used to be enforced silently client-side; a model that doesn't
    // know it keeps writing a fourth companion into the scene.
    expect(content).toContain(`only ${PARTY_LIMIT} companions can be active at once`);
  });

  it("tells the model a created sheet is frozen", () => {
    expect(proto().content).toContain("FROZEN");
  });
});

describe("output protocol — editable character rules", () => {
  const proto = (patch: Partial<Settings>) =>
    build({
      settings: { ...settings, ...patch },
      game: newGame(),
      playerMessage: "go",
    }).find((m) => m.content.includes("OUTPUT PROTOCOL"))!.content;

  it("folds each Advanced character rule into the protocol verbatim", () => {
    const content = proto({
      characterCreationInstructions: "CREATION-RULE",
      namingInstructions: "NAMING-RULE",
      characterUpdateInstructions: "UPDATE-RULE",
      standingInstructions: "STANDING-RULE",
      departureInstructions: "DEPARTURE-RULE",
    });
    expect(content).toContain("- CREATION-RULE");
    expect(content).toContain("- NAMING-RULE");
    expect(content).toContain("- UPDATE-RULE");
    expect(content).toContain("- STANDING-RULE");
    expect(content).toContain("- DEPARTURE-RULE");
  });

  it("keeps the rename shape in the protocol whatever the rules say", () => {
    // The rules are the player's; the field the parser reads is not.
    expect(proto({ namingInstructions: "  " })).toContain('"newName"');
  });

  it("drops a rule the player blanked instead of falling back to a default", () => {
    const content = proto({ departureInstructions: "   " });
    expect(content).not.toContain("Removing never deletes anyone");
    // The surrounding JSON shape is the parser's contract, not guidance — it
    // survives however the player edits the rules around it.
    expect(content).toContain('"party": array of character ops');
  });
});

describe("output protocol — gold", () => {
  it("tells the model Gold is permanent and adjusted via update with a new total", () => {
    const msgs = build({ settings, game: newGame(), playerMessage: "go" });
    const proto = msgs.find((m) => m.content.includes("OUTPUT PROTOCOL"))!;
    expect(proto.content).toContain("Gold is the permanent currency item");
    expect(proto.content).toContain('"label": "Gold"');
    expect(proto.content).toContain("never remove it");
  });
});

describe("output protocol — quest status", () => {
  it("tells the model quests carry a status so it can mark them done", () => {
    const msgs = build({ settings, game: newGame(), playerMessage: "go" });
    const proto = msgs.find((m) => m.content.includes("OUTPUT PROTOCOL"))!;
    expect(proto.content).toContain('"status": "active"|"done"');
    expect(proto.content).toContain('status "done" when the player completes it');
  });
});

describe("buildHistory", () => {
  it("prepends the opening narration as the first assistant turn", () => {
    const g = newGame();
    g.messages = [play(1, "hi"), narr(1, "you see a door")];
    const hist = buildHistory(g, 3000);
    expect(hist[0]).toEqual({ role: "assistant", content: g.scenario.openingNarration });
    expect(hist[1]).toEqual({ role: "user", content: "hi" });
    expect(hist[2]).toEqual({ role: "assistant", content: "you see a door" });
  });

  it("maps player→user and narrator→assistant", () => {
    const g = newGame();
    g.messages = [play(1, "a"), narr(1, "b")];
    const hist = buildHistory(g, 3000);
    expect(hist.map((m) => m.role)).toEqual(["assistant", "user", "assistant"]);
  });

  it("trims oldest turns to the budget but always keeps the opening", () => {
    const g: GameState = newGame();
    const big = "x".repeat(4000); // ~1000 tokens each
    g.messages = [narr(1, big), narr(2, big), narr(3, big)];
    const hist = buildHistory(g, 1500); // opening + ~one big turn
    expect(hist[0].content).toBe(g.scenario.openingNarration);
    // Only the most recent turn(s) fit.
    expect(hist).toContainEqual({ role: "assistant", content: big });
    const bigCount = hist.filter((m) => m.content === big).length;
    expect(bigCount).toBeLessThan(3);
    expect(bigCount).toBeGreaterThanOrEqual(1);
  });

  it("keeps the newest beat even when it alone exceeds the budget", () => {
    const g = newGame();
    const huge = "z".repeat(40000); // ~10k tokens, far over any budget below
    g.messages = [narr(1, "older"), narr(2, huge)];
    const hist = buildHistory(g, 500);
    // The opening is always present; the newest beat survives regardless.
    expect(hist[0].content).toBe(g.scenario.openingNarration);
    expect(hist.some((m) => m.content === huge)).toBe(true);
    // The over-budget newest beat still crowds out the older one.
    expect(hist.some((m) => m.content === "older")).toBe(false);
  });

  it("keeps the newest turn, dropping older ones first", () => {
    const g = newGame();
    g.messages = [narr(1, "OLD".repeat(1000)), narr(2, "NEW")];
    const hist = buildHistory(g, approxTokens(g.scenario.openingNarration) + 5);
    expect(hist.some((m) => m.content === "NEW")).toBe(true);
    expect(hist.some((m) => m.content.startsWith("OLD"))).toBe(false);
  });
});

describe("the clock in the scene block", () => {
  const scene = (game: GameState) =>
    build({ game, playerMessage: "look around" })
      .map((m) => m.content)
      .find((c) => c.includes("CURRENT SCENE")) ?? "";

  it("names the time of day as a phase", () => {
    const g = { ...newGame(), day: 37, minutes: 15 * 60 };
    expect(scene(g)).toContain("day: 37; time: afternoon");
  });

  it("never shows the model a clock face", () => {
    // A model handed "14:30" writes "at half past two" into the prose, which
    // leaks an exact time the player is never shown.
    const g = { ...newGame(), minutes: 14 * 60 + 30 };
    expect(scene(g)).not.toMatch(/\d{1,2}:\d{2}/);
  });
});

describe("journal injection", () => {
  const entry = (day: number, text: string) => ({
    id: `j-${day}`,
    day,
    fromTurn: 1,
    throughTurn: 5,
    lines: [{ text, source: "model" as const }],
  });

  const contents = (patch: Partial<Settings>, game: GameState) =>
    build({ settings: { ...settings, ...patch }, game, playerMessage: "walk on" })
      .map((m) => m.content)
      .join("\n");

  it("injects the block when there are entries", () => {
    const game = { ...newGame(), journal: [entry(1, "Crossed the marsh at dusk.")] };
    const text = contents({}, game);
    expect(text).toContain("JOURNAL");
    expect(text).toContain("Crossed the marsh at dusk.");
  });

  it("injects nothing when the journal is empty", () => {
    expect(contents({}, newGame())).not.toContain("JOURNAL");
  });

  it("injects nothing when the setting is off, entries or not", () => {
    const game = { ...newGame(), journal: [entry(1, "Crossed the marsh at dusk.")] };
    expect(contents({ journalEnabled: false }, game)).not.toContain("JOURNAL");
  });

  it("sits after the history and before the roll call", () => {
    const game = {
      ...newGame(),
      messages: [play(1, "go"), narr(1, "You go.")],
      journal: [entry(1, "Crossed the marsh at dusk.")],
    };
    const roles = build({ game, playerMessage: "walk on" });
    const journalAt = roles.findIndex((m) => m.content.includes("JOURNAL"));
    const historyAt = roles.findIndex((m) => m.content === "You go.");
    const rollCallAt = roles.findIndex((m) => m.content.includes("ACTIVE PARTY — THIS TURN"));
    expect(historyAt).toBeGreaterThanOrEqual(0);
    expect(journalAt).toBeGreaterThan(historyAt);
    expect(rollCallAt).toBeGreaterThan(journalAt);
  });
});

describe("stakes + conditions blocks", () => {
  const risky = {
    risky: true,
    strengthsInPlay: false,
    flawsInPlay: false,
    dice: [2],
    roll: 2,
    modifier: 0,
    total: 2,
    outcome: "cost" as const,
    rules: DEFAULT_DICE,
  };

  it("injects the outcome block when stakes are on", () => {
    const msgs = buildMessages({
      settings,
      game: newGame(),
      characters: [defaultPC()],
      playerMessage: "I attack the bandit",
      stakes: risky,
    });
    const block = msgs.find((m) => m.content.startsWith("OUTCOME — THIS TURN"));
    expect(block).toBeDefined();
    expect(block!.content).toContain("= 2 → COST.");
  });

  it("injects nothing when stakes are off", () => {
    const msgs = buildMessages({
      settings: { ...settings, stakesEnabled: false },
      game: newGame(),
      characters: [defaultPC()],
      playerMessage: "I attack the bandit",
      stakes: risky,
    });
    expect(msgs.some((m) => m.content.startsWith("OUTCOME — THIS TURN"))).toBe(false);
  });

  it("injects nothing for an action that rolled no outcome", () => {
    const msgs = buildMessages({
      settings,
      game: newGame(),
      characters: [defaultPC()],
      playerMessage: "I look around.",
      stakes: { ...risky, risky: false, outcome: null },
    });
    expect(msgs.some((m) => m.content.startsWith("OUTCOME — THIS TURN"))).toBe(false);
  });

  it("places the outcome after the history, with the roll call", () => {
    const g = { ...newGame(), messages: [play(1, "hello"), narr(1, "hi")] };
    const msgs = buildMessages({
      settings,
      game: g,
      characters: [defaultPC()],
      playerMessage: "I attack the bandit",
      stakes: risky,
    });
    const lastHistory = msgs.findIndex((m) => m.content === "hi");
    const outcome = msgs.findIndex((m) => m.content.startsWith("OUTCOME — THIS TURN"));
    expect(outcome).toBeGreaterThan(lastHistory);
    // …and still before the player's new message, which is always last.
    expect(msgs[msgs.length - 1].role).toBe("user");
  });

  it("names a marked character exactly once, in CONDITIONS and not on the sheet", () => {
    const navi = member({ id: "m-navi", name: "Navi" });
    const g = withParty(newGame(), "m-navi");
    g.roster = [{ id: "m-navi", standing: "active", lastSpokeTurn: 0, condition: "Winded" }];
    const msgs = buildMessages({
      settings,
      game: g,
      characters: [defaultPC(), navi],
      playerMessage: "go on",
    });
    const text = msgs.map((m) => m.content).join("\n");
    expect(text).toContain("CONDITIONS —");
    expect(text).toContain("- Navi: Winded");
    // Once. The party roster used to carry a `Condition:` line too, so every
    // mark was shown twice a turn — and a narrator shown a fact twice re-states
    // it, which costs an op, a chip and a line of transcript.
    expect(text.match(/Winded/g)).toHaveLength(1);
    expect(msgs[0].content).not.toContain("Condition:");
  });

  it("marks the PC without repeating it on the PC sheet either", () => {
    const g = newGame();
    g.roster = [{ id: defaultPC().id, standing: "active", lastSpokeTurn: 0, condition: "Limping" }];
    const text = buildMessages({
      settings,
      game: g,
      characters: [defaultPC()],
      playerMessage: "go on",
    })
      .map((m) => m.content)
      .join("\n");
    expect(text).toContain("- Hiro: Limping");
    expect(text.match(/Limping/g)).toHaveLength(1);
  });

  it("documents the conditions field only while stakes are on", () => {
    const on = buildMessages({
      settings,
      game: newGame(),
      characters: [defaultPC()],
      playerMessage: "go",
    });
    const off = buildMessages({
      settings: { ...settings, stakesEnabled: false },
      game: newGame(),
      characters: [defaultPC()],
      playerMessage: "go",
    });
    expect(on.some((m) => m.content.includes('"conditions"'))).toBe(true);
    expect(off.some((m) => m.content.includes('"conditions"'))).toBe(false);
  });
});

describe("formatRegenerateNote", () => {
  it("is empty for a note that isn't one", () => {
    // A plain ↻ Regen must reach the model with the prompt it had before the
    // note box existed — same input, same seed, a different roll.
    expect(formatRegenerateNote("")).toBe("");
    expect(formatRegenerateNote("   \n ")).toBe("");
  });

  it("carries the note and says it is direction, not dialogue", () => {
    const block = formatRegenerateNote("  shorter, and let her refuse  ");
    expect(block).toContain("shorter, and let her refuse");
    expect(block).toContain("RETELL THIS BEAT");
    expect(block.toLowerCase()).toContain("never quote it");
  });
});

describe("buildMessages — regeneration note", () => {
  const game = newGame();

  it("adds nothing when there is no note", () => {
    const plain = build({ game, playerMessage: "I open the door." });
    const noted = buildMessages({
      settings,
      game,
      characters: [defaultPC()],
      playerMessage: "I open the door.",
      regenerateNote: "  ",
    });
    expect(noted.length).toBe(plain.length);
    expect(noted.map((m) => m.content).join("\n")).not.toContain("RETELL THIS BEAT");
  });

  it("injects the note before the output protocol, and never as the player's line", () => {
    const messages = buildMessages({
      settings,
      game,
      characters: [defaultPC()],
      playerMessage: "I open the door.",
      regenerateNote: "keep it to three sentences",
    });
    const idx = messages.findIndex((m) => m.content.includes("keep it to three sentences"));
    expect(idx).toBeGreaterThan(-1);
    expect(messages[idx].role).toBe("system");
    // Still the last word, and still just the action: the note is direction to
    // the narrator, not something the character said.
    const last = messages[messages.length - 1];
    expect(last.role).toBe("user");
    expect(last.content).toBe("I open the door.");
    expect(idx).toBeLessThan(messages.length - 2);
  });
});
