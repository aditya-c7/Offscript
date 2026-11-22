/** Deterministic checks for forms, buttons and observable interactions. */
import type { ButtonInfo, ScanContext } from "@offscript/shared";
import { htmlPages, makeCheck, ratio } from "./util.js";

const HIGH_RISK =
  /\b(buy|purchase|checkout|pay|charge|delete|remove|cancel|transfer|place order|sign out)\b/i;
const MUTATING =
  /\b(submit|send|subscribe|sign in|log in|sign up|register|save|confirm|order|book|apply|create|update)\b/i;
const GATE =
  /\b(confirm|are you sure|review your order|i agree|preview|verify|approve|double-check)\b/i;
const NATIVE_FIELDS = new Set(["input", "select", "textarea"]);
const STATE_ATTRS = [
  "aria-expanded",
  "aria-selected",
  "aria-checked",
  "aria-disabled",
  "aria-pressed",
  "aria-current",
];

function buttonLabel(button: ButtonInfo): string {
  return `${button.text} ${button.ariaLabel ?? ""}`.trim();
}

export function checkSideEffectBoundaries(ctx: ScanContext) {
  const pages = htmlPages(ctx);
  let highRiskUngated = 0;
  let mutatingWithoutForm = 0;
  let mutatingControls = 0;
  let gatedControls = 0;
  const allFormActions: string[] = [];
  for (const page of pages) {
    const dialogGate = (page.feedbackSurfaces ?? []).some((label) =>
      GATE.test(label),
    );
    const forms = page.forms;
    allFormActions.push(...forms.map((form) => form.action ?? ""));
    for (const form of forms) {
      for (const button of form.buttons) {
        const label = buttonLabel(button);
        if (!MUTATING.test(label) && !HIGH_RISK.test(form.action ?? ""))
          continue;
        mutatingControls += 1;
        const gated =
          GATE.test(label) ||
          GATE.test(form.action ?? "") ||
          dialogGate ||
          GATE.test((page.text ?? "").slice(0, 2000));
        if (gated) gatedControls += 1;
        else if (HIGH_RISK.test(label) || HIGH_RISK.test(form.action ?? "")) {
          highRiskUngated += 1;
        }
      }
    }
    for (const button of page.buttons) {
      const label = buttonLabel(button);
      if (!MUTATING.test(label) && !HIGH_RISK.test(label)) continue;
      mutatingControls += 1;
      const gated =
        GATE.test(label) || GATE.test(page.text.slice(0, 2000)) || dialogGate;
      if (gated) gatedControls += 1;
      else if (HIGH_RISK.test(label)) highRiskUngated += 1;
      else if (!button.hasOnClick) mutatingWithoutForm += 1;
    }
  }
  const verdict =
    highRiskUngated > 0 ? "fail" : mutatingWithoutForm > 0 ? "partial" : "pass";
  return makeCheck(ctx, "interaction.side_effect_boundaries", {
    verdict,
    confidence: 0.76,
    evidence: {
      mutating_controls: mutatingControls,
      gated_controls: gatedControls,
      high_risk_ungated: highRiskUngated,
      mutating_without_form: mutatingWithoutForm,
      form_actions_sampled: allFormActions.slice(0, 5),
    },
    selector: "button, form",
  });
}

export function checkOutcomeObservability(ctx: ScanContext) {
  const pages = htmlPages(ctx);
  const forms = pages.flatMap((page) => page.forms);
  if (forms.length === 0) {
    return makeCheck(ctx, "interaction.outcome_observability", {
      verdict: "not_applicable",
      confidence: 0.95,
      evidence: { forms_found: 0 },
    });
  }
  const observable = forms.filter((form) => {
    if (form.hasLiveRegion) return true;
    const page = pages.find((candidate) => candidate.forms.includes(form));
    return Boolean(
      page &&
      (page.ariaLiveCount > 0 ||
        page.feedbackSurfaces.some((surface) => /status|alert/i.test(surface))),
    );
  }).length;
  const coverage = ratio(observable, forms.length);
  const verdict =
    coverage >= 0.999 ? "pass" : coverage > 0 ? "partial" : "fail";
  return makeCheck(ctx, "interaction.outcome_observability", {
    verdict,
    confidence: 0.9,
    evidence: {
      forms_found: forms.length,
      forms_with_live_region: observable,
      coverage,
    },
    selector: "form [role=status], form [aria-live]",
  });
}

export function checkControlContract(ctx: ScanContext) {
  const pages = htmlPages(ctx);
  const forms = pages.flatMap((page) => page.forms);
  if (forms.length === 0) {
    return makeCheck(ctx, "interaction.control_contract", {
      verdict: "not_applicable",
      confidence: 0.95,
      evidence: { forms_found: 0 },
    });
  }
  let complete = 0;
  const issues: string[] = [];
  for (const form of forms) {
    const action = (form.action ?? "").trim();
    const method = (form.method ?? "").trim();
    const fieldsOk = form.fields.every(
      (field) =>
        NATIVE_FIELDS.has(field.tag.toLowerCase()) &&
        field.name.trim().length > 0 &&
        (field.required || (field.autocomplete ?? "").trim().length > 0),
    );
    if (action.length > 0 && method.length > 0 && fieldsOk) complete += 1;
    else {
      issues.push(
        `${form.selector}: action=${action || "none"} method=${method || "none"} fields_ok=${fieldsOk}`,
      );
    }
  }
  const coverage = ratio(complete, forms.length);
  const verdict =
    coverage >= 0.999 ? "pass" : coverage > 0 ? "partial" : "fail";
  return makeCheck(ctx, "interaction.control_contract", {
    verdict,
    confidence: 0.89,
    evidence: {
      forms_found: forms.length,
      forms_complete: complete,
      coverage,
      issues: issues.slice(0, 8),
    },
    snippet: issues.slice(0, 3).join(" | ") || null,
    selector: "form",
  });
}

export function checkAccessibleButtonNames(ctx: ScanContext) {
  const pages = htmlPages(ctx);
  const buttons = pages.flatMap((page) => [
    ...page.buttons,
    ...page.forms.flatMap((form) => form.buttons),
  ]);
  if (buttons.length === 0) {
    return makeCheck(ctx, "interaction.accessible_button_names", {
      verdict: "not_applicable",
      confidence: 0.95,
      evidence: { buttons_found: 0 },
    });
  }
  const named = buttons.filter(
    (button) => buttonLabel(button).length > 0,
  ).length;
  const coverage = ratio(named, buttons.length);
  const verdict =
    coverage >= 0.999 ? "pass" : coverage >= 0.8 ? "partial" : "fail";
  return makeCheck(ctx, "interaction.accessible_button_names", {
    verdict,
    confidence: 0.97,
    evidence: {
      buttons_found: buttons.length,
      buttons_with_name: named,
      coverage,
      unnamed_selectors: buttons
        .filter((button) => buttonLabel(button).length === 0)
        .slice(0, 8)
        .map((button) => button.selector),
    },
    selector: "button, [role=button]",
  });
}

export function checkFormFieldLabeling(ctx: ScanContext) {
  const pages = htmlPages(ctx);
  const fields = pages.flatMap((page) =>
    page.forms.flatMap((form) => form.fields),
  );
  if (fields.length === 0) {
    return makeCheck(ctx, "interaction.form_field_labeling", {
      verdict: "not_applicable",
      confidence: 0.95,
      evidence: { fields_found: 0 },
    });
  }
  const labeled = fields.filter((field) => {
    if ((field.label ?? "").trim().length > 0) return true;
    if (!field.id) return false;
    const page = pages.find((candidate) =>
      candidate.forms.some((form) => form.fields.includes(field)),
    );
    if (!page) return false;
    return new RegExp(
      `<label[^>]+for=["']${field.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`,
      "i",
    ).test(`${page.rawHtml} ${page.renderedHtml}`);
  }).length;
  const coverage = ratio(labeled, fields.length);
  const verdict =
    coverage >= 0.999 ? "pass" : coverage >= 0.8 ? "partial" : "fail";
  return makeCheck(ctx, "interaction.form_field_labeling", {
    verdict,
    confidence: 0.94,
    evidence: {
      fields_found: fields.length,
      fields_labeled: labeled,
      coverage,
      unlabeled_selectors: fields
        .filter((field) => (field.label ?? "").trim().length === 0)
        .slice(0, 8)
        .map((field) => field.selector),
    },
    selector: "input, select, textarea",
  });
}

export function checkStateAnnouncements(ctx: ScanContext) {
  const pages = htmlPages(ctx);
  const stateAttrs = pages.flatMap((page) => page.stateAttrs ?? []);
  const interactiveCount = pages.reduce(
    (sum, page) =>
      sum +
      page.buttons.length +
      page.forms.reduce(
        (inner, form) => inner + form.fields.length + form.buttons.length,
        0,
      ),
    0,
  );
  const disabledButtons = pages
    .flatMap((page) => [
      ...page.buttons,
      ...page.forms.flatMap((form) => form.buttons),
    ])
    .filter((button) => button.disabled).length;
  const relevant = stateAttrs.filter((attr) =>
    STATE_ATTRS.some((name) => attr.toLowerCase().includes(name)),
  );
  if (interactiveCount === 0) {
    return makeCheck(ctx, "interaction.state_announcements", {
      verdict: "not_applicable",
      confidence: 0.93,
      evidence: { interactive_controls: 0 },
    });
  }
  const count = uniqueRelevant(relevant);
  const verdict = count + disabledButtons > 0 ? "pass" : "fail";
  return makeCheck(ctx, "interaction.state_announcements", {
    verdict,
    confidence: 0.82,
    evidence: {
      interactive_controls: interactiveCount,
      state_attribute_count: count,
      disabled_buttons: disabledButtons,
      state_attrs_sample: relevant.slice(0, 10),
    },
    selector: "[aria-expanded], [aria-selected], [aria-checked], [disabled]",
  });
}

function uniqueRelevant(values: string[]): number {
  return new Set(values.map((value) => value.toLowerCase())).size;
}
