import { useState } from "react";
import { useStore } from "../store";
import { MenuLink } from "./SubMenuScreen";
import { ComfyChoiceField, NumberField } from "./ComfyChoiceField";
import {
  fieldLabel,
  filledInput,
  filledTextarea,
  notice,
  pillOutline,
} from "./material";
import {
  DEFAULT_COMFY_WORKFLOW,
  MAX_COMFY_CLIP_SKIP,
  MAX_COMFY_SCALE,
  MAX_COMFY_SIDE,
  MAX_COMFY_STEPS,
  MIN_COMFY_SIDE,
  type ComfyOptions,
  fetchComfyOptions,
  pingComfy,
  validateWorkflow,
} from "../lib/comfyui";

type Check =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "ok"; note: string }
  | { state: "bad"; note: string };

const NO_OPTIONS: ComfyOptions = { models: [], samplers: [], schedulers: [], vaes: [] };

/**
 * The ComfyUI half of Images → Model (DESIGN.md → Image Generation → Backends).
 * Material redesign (`Loom Material Redesign.dc.html`).
 *
 * Connect first, then everything else: pressing Connect both proves the URL and
 * fills the four name pickers from `/object_info`, because a wrong host and a
 * mistyped checkpoint name fail identically — as a portrait that never appears
 * — and neither is visible anywhere else in the app.
 *
 * The workflow itself is folded away. It is the most powerful control here and
 * the one almost nobody needs to touch: the shipped graph works, and a player
 * who wants a LoRA stack or a Flux pipeline knows to go looking.
 */
export function ComfyFields() {
  const settings = useStore((s) => s.settings);
  const update = useStore((s) => s.updateSettings);
  const [check, setCheck] = useState<Check>({ state: "idle" });
  const [options, setOptions] = useState<ComfyOptions>(NO_OPTIONS);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const workflowError = validateWorkflow(settings.comfyWorkflow);

  async function connect() {
    setCheck({ state: "checking" });
    try {
      const ping = await pingComfy(settings.comfyUrl);
      // Only after the server has answered — asking a dead host four more
      // questions just delays the error the player is waiting for.
      setOptions(await fetchComfyOptions(settings.comfyUrl));
      setCheck({
        state: "ok",
        note: [`ComfyUI ${ping.version}`, ping.device].filter(Boolean).join(" · "),
      });
    } catch (err) {
      setOptions(NO_OPTIONS);
      setCheck({
        state: "bad",
        note: err instanceof Error ? err.message : "Could not reach ComfyUI.",
      });
    }
  }

  return (
    <div className="space-y-5">
      <div className="space-y-1.5">
        <span className={fieldLabel}>ComfyUI Address</span>
        <div className="flex items-stretch gap-2">
          <input
            type="url"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            value={settings.comfyUrl}
            onChange={(e) => {
              update({ comfyUrl: e.target.value });
              setCheck({ state: "idle" });
            }}
            placeholder="http://127.0.0.1:8188"
            className={`min-w-0 flex-1 ${filledInput}`}
          />
          <button
            type="button"
            disabled={check.state === "checking"}
            onClick={() => void connect()}
            className={`shrink-0 ${pillOutline}`}
          >
            {check.state === "checking" ? "…" : "Connect"}
          </button>
        </div>

        {check.state === "ok" && (
          <p className="text-[13px]" role="status">
            ✓ {check.note}
            {options.models.length ? ` · ${options.models.length} models` : ""}
          </p>
        )}
        {check.state === "bad" && (
          <p className="text-[13px] text-danger" role="alert">
            ✗ {check.note}
          </p>
        )}
        <p className="text-[12.5px] leading-relaxed text-[var(--m-text-55)]">
          Start ComfyUI with{" "}
          <code className="rounded-[4px] bg-[var(--m-surface-strong)] px-1 py-0.5 font-mono text-[12px]">
            --enable-cors-header
          </code>{" "}
          so this app may talk to it, and add{" "}
          <code className="rounded-[4px] bg-[var(--m-surface-strong)] px-1 py-0.5 font-mono text-[12px]">
            --listen 0.0.0.0
          </code>{" "}
          plus the computer's own address (not 127.0.0.1) to reach it from a phone on the
          same network. Nothing is sent to OpenRouter while this backend is selected, and
          no key is needed.
        </p>
      </div>

      <ComfyChoiceField
        label="Checkpoint"
        value={settings.comfyModel}
        onChange={(v) => update({ comfyModel: v })}
        options={options.models}
        placeholder="model.safetensors"
        hint="Press Connect to list what's installed."
      />

      <div className="grid grid-cols-2 gap-2.5">
        <ComfyChoiceField
          label="Sampler"
          value={settings.comfySampler}
          onChange={(v) => update({ comfySampler: v })}
          options={options.samplers}
        />
        <ComfyChoiceField
          label="Scheduler"
          value={settings.comfyScheduler}
          onChange={(v) => update({ comfyScheduler: v })}
          options={options.schedulers}
        />
      </div>

      <div className="grid grid-cols-2 gap-2.5">
        <NumberField
          label="Steps"
          value={settings.comfySteps}
          onChange={(v) => update({ comfySteps: v })}
          min={1}
          max={MAX_COMFY_STEPS}
        />
        <NumberField
          label="CFG"
          value={settings.comfyScale}
          onChange={(v) => update({ comfyScale: v })}
          min={0}
          max={MAX_COMFY_SCALE}
          step={0.5}
        />
      </div>

      <div className="grid grid-cols-2 gap-2.5">
        <NumberField
          label="Width"
          value={settings.comfyWidth}
          onChange={(v) => update({ comfyWidth: v })}
          min={MIN_COMFY_SIDE}
          max={MAX_COMFY_SIDE}
          step={64}
        />
        <NumberField
          label="Height"
          value={settings.comfyHeight}
          onChange={(v) => update({ comfyHeight: v })}
          min={MIN_COMFY_SIDE}
          max={MAX_COMFY_SIDE}
          step={64}
        />
      </div>
      <p className="text-[12.5px] leading-relaxed text-[var(--m-text-55)]">
        Location images use this size as it stands. A portrait is redrawn to 2:3 at the
        same number of pixels, so both cost about the same to render.
      </p>

      {/* The negative prompt moved to Images → Prompt Templates, with the rest of
          the wording: it is dialect, not machine config, and an SD-tag template
          wants a different one from a descriptive template on the same server. */}
      <p className="text-[12.5px] leading-relaxed text-[var(--m-text-55)]">
        The negative prompt lives with the rest of the wording, under{" "}
        <MenuLink screen="images" section="prompts">
          Prompt Templates
        </MenuLink>{" "}
        — it changes with the prompt template rather than with the server.
      </p>

      <div className="rounded-[14px] bg-[var(--m-surface)] p-4">
        <button
          type="button"
          aria-expanded={advancedOpen}
          onClick={() => setAdvancedOpen((o) => !o)}
          className="flex w-full items-center justify-between gap-2.5 text-left text-[15px] font-medium"
        >
          <span>Advanced ComfyUI</span>
          <svg
            viewBox="0 0 24 24"
            width="16"
            height="16"
            fill="none"
            stroke="var(--m-outline)"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={`shrink-0 transition-transform ${advancedOpen ? "rotate-180" : ""}`}
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>

        {advancedOpen && (
          <div className="mt-3.5 space-y-4">
            <ComfyChoiceField
              label="VAE"
              value={settings.comfyVae}
              onChange={(v) => update({ comfyVae: v })}
              options={options.vaes}
              hint="Only used by a workflow with a %vae% placeholder. Blank means the checkpoint's own."
            />

            <NumberField
              label="Clip Skip"
              value={settings.comfyClipSkip}
              onChange={(v) => update({ comfyClipSkip: v })}
              min={1}
              max={MAX_COMFY_CLIP_SKIP}
              hint="Only used by a workflow with a %clip_skip% placeholder."
            />

            <NumberField
              label="Denoise"
              value={settings.comfyDenoise}
              onChange={(v) => update({ comfyDenoise: v })}
              min={0}
              max={1}
              step={0.05}
              hint="Only used by a workflow with a %denoise% placeholder. The shipped one draws from scratch."
            />

            <div className="space-y-1.5">
              <span className={fieldLabel}>Workflow</span>
              <textarea
                value={settings.comfyWorkflow}
                rows={12}
                spellCheck={false}
                onChange={(e) => update({ comfyWorkflow: e.target.value })}
                className={`font-mono text-[12px] ${filledTextarea}`}
              />
              {workflowError && (
                <p className="text-[13px] text-danger" role="alert">
                  ✗ {workflowError}
                </p>
              )}
              <p className="text-[12.5px] leading-relaxed text-[var(--m-text-55)]">
                A ComfyUI workflow in API format — export one with Save (API Format) after
                switching on Dev Mode in ComfyUI's settings. The values above are substituted
                into it wherever these appear, quotes included:{" "}
                <code className="rounded-[4px] bg-[var(--m-surface-strong)] px-1 py-0.5 font-mono text-[11.5px]">
                  &quot;%prompt%&quot; &quot;%negative_prompt%&quot; &quot;%model%&quot;
                  &quot;%vae%&quot; &quot;%sampler%&quot; &quot;%scheduler%&quot;
                  &quot;%steps%&quot; &quot;%scale%&quot; &quot;%width%&quot;
                  &quot;%height%&quot; &quot;%denoise%&quot; &quot;%clip_skip%&quot;
                  &quot;%seed%&quot;
                </code>
                . Keep the quotes even around numbers. Anything you'd rather fix in place —
                a LoRA, a refiner — just leave hardcoded.
              </p>
              <button
                type="button"
                onClick={() => update({ comfyWorkflow: DEFAULT_COMFY_WORKFLOW })}
                disabled={settings.comfyWorkflow === DEFAULT_COMFY_WORKFLOW}
                className={`${pillOutline} !min-h-9 !px-3.5`}
              >
                Reset to default
              </button>
            </div>
          </div>
        )}
      </div>

      <p className={notice}>
        Portrait style reference images (
        <MenuLink screen="images" section="prompts">
          Prompt Templates
        </MenuLink>
        ) are not sent to ComfyUI — build the look into the workflow instead.
      </p>
    </div>
  );
}
